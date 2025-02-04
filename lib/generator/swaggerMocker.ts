import { JsonLoader } from "../swagger/jsonLoader";
import { log } from "../util/logging";
import {
  buildItemOption,
  CacheItem,
  createLeafItem,
  createTrunkItem,
  MockerCache,
  reBuildExample,
  PayloadCache,
} from "./exampleCache";
import Mocker from "./mocker";
import * as util from "./util";
import { ExampleRule, getRuleValidator } from "./exampleRule";

export default class SwaggerMocker {
  private jsonLoader: JsonLoader;
  private mocker: Mocker;
  private spec: any;
  private mockCache: MockerCache;
  private exampleCache: PayloadCache;
  private exampleRule?: ExampleRule;

  public constructor(jsonLoader: JsonLoader, mockerCache: MockerCache, payloadCache: PayloadCache) {
    this.jsonLoader = jsonLoader;
    this.mocker = new Mocker();
    this.mockCache = mockerCache;
    this.exampleCache = payloadCache;
  }

  public setRule(exampleRule?: ExampleRule) {
    this.exampleRule = exampleRule;
  }

  public mockForExample(example: any, specItem: any, spec: any, rp: string) {
    const preHandledStatusCode = ["200", "201", "202", "204"]; // above status code prehandle in exampleGenerator.ts extractResponse()
    this.spec = spec;
    if (Object.keys(example.responses).length === 0) {
      for (const statusCode of Object.keys(specItem.content.responses)) {
        if (statusCode !== "default") {
          example.responses[`${statusCode}`] = {};
        }
      }
    } else {
      for (const statusCode of Object.keys(specItem.content.responses)) {
        if (statusCode !== "default" && !preHandledStatusCode.includes(statusCode)) {
          example.responses[`${statusCode}`] = {};
        }
      }
    }
    example.parameters = this.mockRequest(example.parameters, specItem.content.parameters, rp);
    example.responses = this.mockResponse(example.responses, specItem);
  }

  public getMockCachedObj(objName: string, schema: any, isRequest: boolean) {
    return this.mockCachedObj(objName, schema, undefined, new Set<string>(), isRequest);
  }

  private mockResponse(responseExample: any, specItem: any) {
    for (const statusCode of Object.keys(responseExample)) {
      const mockedResp = this.mockEachResponse(statusCode, responseExample[statusCode], specItem);
      responseExample[statusCode] = mockedResp;
    }
    return responseExample;
  }

  private mockEachResponse(statusCode: string, responseExample: any, specItem: any) {
    const visited = new Set<string>();
    const validator = getRuleValidator(this.exampleRule).onResponseBody;
    const responseSpec = specItem.content.responses[statusCode];
    if (validator && !validator({ schema: responseSpec })) {
      return undefined;
    }
    return {
      headers: responseExample.hearders || this.mockHeaders(statusCode, specItem),
      body:
        "schema" in responseSpec
          ? this.mockObj(
              "response body",
              responseSpec.schema,
              responseExample.body || {},
              visited,
              false
            ) || {}
          : undefined,
    };
  }

  private mockHeaders(statusCode: string, specItem: any) {
    if (statusCode !== "201" && statusCode !== "202") {
      return undefined;
    }
    const validator = getRuleValidator(this.exampleRule).onResponseHeader;
    if (validator && !validator({ schema: specItem })) {
      return undefined;
    }
    const headerAttr = util.getPollingAttr(specItem);
    if (!headerAttr) {
      return;
    }
    return {
      [headerAttr]: "https://foo.com/operationstatus",
    };
  }

  private mockRequest(paramExample: any, paramSpec: any, rp: string) {
    const validator = getRuleValidator(this.exampleRule).onParameter;
    for (const pName of Object.keys(paramSpec)) {
      const element = paramSpec[pName];
      const visited = new Set<string>();

      const paramEle = this.getDefSpec(element, visited);
      if (paramEle.name === "resourceGroupName") {
        paramExample.resourceGroupName = `rg${rp}`;
      } else if (paramEle.name === "api-version") {
        paramExample["api-version"] = this.spec.info.version;
      } else if ("schema" in paramEle) {
        // {
        //     "name": "parameters",
        //     "in": "body",
        //     "required": false,
        //     "schema": {
        //       "$ref": "#/definitions/SignalRResource"
        //     }
        // }
        if (!validator || validator({ schema: paramEle })) {
          paramExample[paramEle.name] = this.mockObj(
            paramEle.name,
            paramEle.schema,
            paramExample[paramEle.name] || {},
            visited,
            true
          );
        }
      } else {
        if (paramEle.name in paramExample) {
          continue;
        }
        // {
        //     "name": "api-version",
        //     "in": "query",
        //     "required": true,
        //     "type": "string"
        // }
        if (!validator || validator({ schema: paramEle })) {
          paramExample[paramEle.name] = this.mockObj(
            paramEle.name,
            element, // use the original schema  containing "$ref" which will hit the cached value
            paramExample[paramEle.name],
            new Set<string>(),
            true
          );
        }
      }
    }
    return paramExample;
  }

  private removeFromSet(schema: any, visited: Set<string>) {
    if ("$ref" in schema && visited.has(schema.$ref)) {
      visited.delete(schema.$ref);
    }
  }

  private getCache(schema: any) {
    if ("$ref" in schema) {
      for (const cache of [this.exampleCache, this.mockCache]) {
        if (cache.has(schema.$ref.split("#")[1])) {
          return cache.get(schema.$ref.split("#")[1]);
        }
      }
    }
    return undefined;
  }

  private mockObj(
    objName: string,
    schema: any,
    example: any,
    visited: Set<string>,
    isRequest: boolean
  ) {
    const cache = this.mockCachedObj(objName, schema, example, visited, isRequest);
    const validator = getRuleValidator(this.exampleRule).onSchema;
    return reBuildExample(cache, isRequest, schema, validator);
  }

  private mockCachedObj(
    objName: string,
    schema: any,
    example: any,
    visited: Set<string>,
    isRequest: boolean,
    discriminatorValue: string | undefined = undefined
  ) {
    if (!schema || typeof schema !== "object") {
      log.warn(`invalid schema.`);
      return undefined;
    }
    // use visited set to avoid circular dependency
    if ("$ref" in schema && visited.has(schema.$ref)) {
      return undefined;
    }
    const cache = this.getCache(schema);
    if (cache) {
      return cache;
    }
    const definitionSpec = this.getDefSpec(schema, visited);

    if (util.isObject(definitionSpec)) {
      // circular inherit will not be handled
      const properties = this.getProperties(definitionSpec, visited);
      example = example || {};
      const discriminator = this.getDiscriminator(definitionSpec, visited);
      if (
        discriminator &&
        !discriminatorValue &&
        properties &&
        Object.keys(properties).includes(discriminator)
      ) {
        return (
          this.mockForDiscriminator(definitionSpec, example, discriminator, isRequest, visited) ||
          undefined
        );
      } else {
        Object.keys(properties).forEach((key: string) => {
          // the objName is the discriminator when discriminatorValue is specified.
          if (key === objName && discriminatorValue) {
            example[key] = createLeafItem(discriminatorValue, buildItemOption(properties[key]));
          } else {
            example[key] = this.mockCachedObj(
              key,
              properties[key],
              example[key],
              visited,
              isRequest,
              discriminatorValue
            );
          }
        });
      }
      if ("additionalProperties" in definitionSpec && definitionSpec.additionalProperties) {
        const newKey = util.randomKey();
        if (newKey in properties) {
          console.error(`generate additionalProperties for ${objName} fail`);
        } else {
          example[newKey] = this.mockCachedObj(
            newKey,
            definitionSpec.additionalProperties,
            undefined,
            visited,
            isRequest,
            discriminatorValue
          );
        }
      }
    } else if (definitionSpec.type === "array") {
      example = example || [];
      const arrItem: any = this.mockCachedObj(
        `${objName}'s item`,
        definitionSpec.items,
        example[0],
        visited,
        isRequest
      );
      example = this.mocker.mock(definitionSpec, objName, arrItem);
    } else {
      /** type === number or integer  */
      example = example ? example : this.mocker.mock(definitionSpec, objName);
    }
    // return value for primary type: string, number, integer, boolean
    // "aaaa"
    // removeFromSet: once we try all roads started from present node, we should remove it and backtrack
    this.removeFromSet(schema, visited);

    let cacheItem: CacheItem;
    if (Array.isArray(example)) {
      const cacheChild: CacheItem[] = [];
      for (const item of example) {
        cacheChild.push(item);
      }
      cacheItem = createTrunkItem(cacheChild, buildItemOption(definitionSpec));
    } else if (typeof example === "object") {
      const cacheChild: { [index: string]: CacheItem } = {};
      for (const [key, item] of Object.entries(example)) {
        cacheChild[key] = item as CacheItem;
      }
      cacheItem = createTrunkItem(cacheChild, buildItemOption(definitionSpec));
    } else {
      cacheItem = createLeafItem(example, buildItemOption(definitionSpec));
    }
    cacheItem.isMocked = true;
    const requiredProperties = this.getRequiredProperties(definitionSpec);
    if (requiredProperties && requiredProperties.length > 0) {
      cacheItem.required = requiredProperties;
    }
    this.mockCache.checkAndCache(schema, cacheItem);
    return cacheItem;
  }

  /**
   * return all required properties of the object, including parent's properties defined by 'allOf'
   * It will not spread properties' properties.
   * @param definitionSpec
   */
  private getRequiredProperties(definitionSpec: any) {
    let requiredProperties: string[] = Array.isArray(definitionSpec.required)
      ? definitionSpec.required
      : [];
    definitionSpec.allOf?.map((item: any) => {
      requiredProperties = [
        ...requiredProperties,
        ...this.getRequiredProperties(this.getDefSpec(item, new Set<string>())),
      ];
    });
    return requiredProperties;
  }

  // TODO: handle discriminator without enum options
  private mockForDiscriminator(
    schema: any,
    example: any,
    discriminator: string,
    isRequest: boolean,
    visited: Set<string>
  ): any {
    const disDetail = this.getDefSpec(schema, visited);
    if (disDetail.discriminatorMap && Object.keys(disDetail.discriminatorMap).length > 0) {
      const properties = this.getProperties(disDetail, new Set<string>());
      let discriminatorValue;
      if (properties[discriminator] && Array.isArray(properties[discriminator].enum)) {
        discriminatorValue = properties[discriminator].enum[0];
      } else {
        discriminatorValue = Object.keys(disDetail.discriminatorMap)[0];
      }
      const discriminatorSpec = disDetail.discriminatorMap[discriminatorValue];
      if (!discriminatorSpec) {
        this.removeFromSet(schema, visited);
        return example;
      }
      const cacheItem =
        this.mockCachedObj(
          discriminator,
          discriminatorSpec,
          {},
          new Set<string>(),
          isRequest,
          discriminatorValue
        ) || undefined;
      this.removeFromSet(schema, visited);
      return cacheItem;
    }
    this.removeFromSet(schema, visited);
    return undefined;
  }

  // {
  //  "$ref": "#/parameters/ApiVersionParameter"
  // },
  // to
  // {
  //     "name": "api-version",
  //     "in": "query",
  //     "required": true,
  //     "type": "string"
  // }
  private getDefSpec(schema: any, visited: Set<string>) {
    if ("$ref" in schema) {
      visited.add(schema.$ref);
    }

    const content = this.jsonLoader.resolveRefObj(schema);
    if (!content) {
      return undefined;
    }
    return content;
  }

  private getProperties(definitionSpec: any, visited: Set<string>) {
    let properties: any = {};
    definitionSpec.allOf?.map((item: any) => {
      properties = {
        ...properties,
        ...this.getProperties(this.getDefSpec(item, visited), visited),
      };
      this.removeFromSet(item, visited);
    });
    return {
      ...properties,
      ...definitionSpec.properties,
    };
  }

  private getDiscriminator(definitionSpec: any, visited: Set<string>) {
    let discriminator = undefined;
    if (definitionSpec.discriminator) {
      return definitionSpec.discriminator;
    }
    definitionSpec.allOf?.some((item: any) => {
      discriminator = this.getDiscriminator(this.getDefSpec(item, visited), visited);
      this.removeFromSet(item, visited);
      return !!discriminator;
    });
    return discriminator;
  }
}
