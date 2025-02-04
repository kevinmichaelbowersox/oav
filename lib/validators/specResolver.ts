// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as path from "path";
import * as openapiToolsCommon from "@azure-tools/openapi-tools-common";
import { Suppression } from "@azure/openapi-markdown";
import * as jsonPointer from "json-pointer";
import * as _ from "lodash";
import {
  DefinitionsObject,
  OperationObject,
  ParameterObject,
  ParametersDefinitionsObject,
  PathsObject,
  SchemaObject,
  SwaggerObject,
} from "yasway";
import * as C from "../util/constants";
import { defaultIfUndefinedOrNull } from "../util/defaultIfUndefinedOrNull";
import { DocCache } from "../util/documents";
import * as jsonRefs from "../util/jsonRefs";
import * as jsonUtils from "../util/jsonUtils";
import { log } from "../util/logging";
import { getOperations } from "../util/methods";
import * as utils from "../util/utils";
import { PolymorphicTree } from "./polymorphicTree";
import { resolveNestedDefinitions } from "./resolveNestedDefinitions";

const ErrorCodes = C.ErrorCodes;

export interface Options {
  consoleLogLevel?: unknown;
  shouldResolveRelativePaths?: boolean | null;
  shouldResolveXmsExamples?: boolean | null;
  shouldResolveAllOf?: boolean;
  shouldSetAdditionalPropertiesFalse?: boolean;
  shouldResolvePureObjects?: boolean | null;
  shouldResolveDiscriminator?: boolean;
  shouldResolveParameterizedHost?: boolean | null;
  shouldResolveNullableTypes?: boolean;
}

export interface RefDetails {
  def: {
    $ref: string;
  };
}

/**
 * @class
 * Resolves the swagger spec by unifying x-ms-paths, resolving relative file references if any,
 * resolving the allOf is present in any model definition and then setting additionalProperties
 * to false if it is not previously set to true or an object in that definition.
 */
export class SpecResolver {
  public specInJson: SwaggerObject;

  private readonly specPath: string;

  private readonly specDir: unknown;

  private readonly visitedEntities: openapiToolsCommon.MutableStringMap<SchemaObject> = {};

  private readonly resolvedAllOfModels: openapiToolsCommon.MutableStringMap<SchemaObject> = {};

  private readonly options: Options;

  /**
   * @constructor
   * Initializes a new instance of the SpecResolver class.
   *
   * @param {string} specPath the (remote|local) swagger spec path
   *
   * @param {object} specInJson the parsed spec in json format
   *
   * @param {object} [options] The options object
   *
   * @param {object} [options.shouldResolveRelativePaths] Should relative paths be resolved?
   *    Default: true
   *
   * @param {object} [options.shouldResolveXmsExamples] Should x-ms-examples be resolved?
   *    Default: true. If options.shouldResolveRelativePaths is false then this option will also be
   *    false implicitly and cannot be overridden.
   *
   * @param {object} [options.shouldResolveAllOf] Should allOf references be resolved? Default: true
   *
   * @param {object} [options.shouldResolveDiscriminator] Should discriminator be resolved?
   *    Default: true
   *
   * @param {object} [options.shouldSetAdditionalPropertiesFalse] Should additionalProperties be set
   *    to false? Default: true
   *
   * @param {object} [options.shouldResolvePureObjects] Should pure objects be resolved?
   *    Default: true
   *
   * @param {object} [options.shouldResolveParameterizedHost] Should x-ms-parameterized-host be
   *    resolved? Default: true
   *
   * @param {object} [options.shouldResolveNullableTypes] Should we allow null values to match any
   *    type? Default: true
   */
  public constructor(
    specPath: string,
    specInJson: SwaggerObject,
    options: Options,
    private readonly reportError: openapiToolsCommon.ReportError,
    private readonly docsCache: DocCache = {}
  ) {
    if (
      specPath === null ||
      specPath === undefined ||
      typeof specPath !== "string" ||
      !specPath.trim().length
    ) {
      throw new Error(
        "specPath is a required property of type string and it cannot be an empty string."
      );
    }

    if (specInJson === null || specInJson === undefined || typeof specInJson !== "object") {
      throw new Error("specInJson is a required property of type object");
    }
    this.specInJson = specInJson;
    this.specPath = specPath;
    this.specDir = path.dirname(this.specPath);

    options = defaultIfUndefinedOrNull<Options>(options, {});

    options.shouldResolveRelativePaths = defaultIfUndefinedOrNull(
      options.shouldResolveRelativePaths,
      true
    );

    options.shouldResolveXmsExamples = defaultIfUndefinedOrNull(
      options.shouldResolveXmsExamples,
      true
    );

    if (options.shouldResolveAllOf === null || options.shouldResolveAllOf === undefined) {
      if (!_.isUndefined(specInJson.definitions)) {
        options.shouldResolveAllOf = true;
      }
    }

    // Resolving allOf is a necessary precondition for resolving discriminators. Hence hard setting
    // this to true
    if (options.shouldResolveDiscriminator) {
      options.shouldResolveAllOf = true;
    }

    options.shouldSetAdditionalPropertiesFalse = defaultIfUndefinedOrNull(
      options.shouldSetAdditionalPropertiesFalse,
      options.shouldResolveAllOf
    );

    options.shouldResolvePureObjects = defaultIfUndefinedOrNull(
      options.shouldResolvePureObjects,
      true
    );

    options.shouldResolveDiscriminator = defaultIfUndefinedOrNull(
      options.shouldResolveDiscriminator,
      options.shouldResolveAllOf
    );

    options.shouldResolveParameterizedHost = defaultIfUndefinedOrNull(
      options.shouldResolveParameterizedHost,
      true
    );

    options.shouldResolveNullableTypes = defaultIfUndefinedOrNull(
      options.shouldResolveNullableTypes,
      options.shouldResolveAllOf
    );

    this.options = options;
  }

  /**
   * Resolves the swagger spec by unifying x-ms-paths, resolving relative file references if any,
   * resolving the allOf is present in any model definition and then setting additionalProperties
   * to false if it is not previously set to true or an object in that definition.
   */
  public async resolve(suppression: Suppression | undefined): Promise<this> {
    try {
      // path resolvers
      this.verifyInternalReference();

      this.unifyXmsPaths();
      if (this.options.shouldResolveRelativePaths) {
        await this.resolveRelativePaths(suppression);
      }
      // resolve nested definitions
      this.specInJson = resolveNestedDefinitions(this.specInJson);

      // other resolvers (should be moved to resolveNestedDefinitions())
      if (this.options.shouldResolveAllOf) {
        this.resolveAllOfInDefinitions();
      }
      if (this.options.shouldResolveDiscriminator) {
        this.resolveDiscriminator();
      }
      if (this.options.shouldResolveAllOf) {
        this.deleteReferencesToAllOf();
      }
      if (this.options.shouldSetAdditionalPropertiesFalse) {
        this.setAdditionalPropertiesFalse();
      }
      if (this.options.shouldResolveParameterizedHost) {
        this.resolveParameterizedHost();
      }
      if (this.options.shouldResolvePureObjects) {
        this.resolvePureObjects();
      }
      if (this.options.shouldResolveNullableTypes) {
        this.resolveNullableTypes();
      }
    } catch (err) {
      // to avoid double wrap the exception
      if (typeof err === "object" && err.id && err.message) {
        throw err;
      }
      const e = {
        message: `internal error: ${err.message}`,
        code: ErrorCodes.InternalError.name,
        id: ErrorCodes.InternalError.id,
        innerErrors: [err],
      };
      log.error(err);
      throw e;
    }
    return this;
  }

  /**
   * Resolves the references to relative paths in the provided object.
   *
   * @param {object} [doc] the json doc that contains relative references. Default: self.specInJson
   *    (current swagger spec).
   *
   * @param {string} [docPath] the absolute (local|remote) path of the doc Default: self.specPath
   *    (current swagger spec path).
   *
   * @param {string} [filterType] the type of paths to filter. By default the method will resolve
   *    'relative' and 'remote' references.
   *    If provided the value should be 'all'. This indicates that 'local' references should also be
   *    resolved apart from the default ones.
   *
   * @return {Promise<void>}
   */
  private async resolveRelativePaths(
    suppression: Suppression | undefined,
    doc?: openapiToolsCommon.StringMap<unknown>,
    docPath?: string,
    filterType?: string
  ): Promise<void> {
    let docDir;

    const options = {
      /* TODO: it looks like a bug, relativeBase is always undefined */
      relativeBase: docDir,
      filter: ["relative", "remote"],
    };

    if (!doc) {
      doc = this.specInJson;
    }
    if (!docPath) {
      docPath = this.specPath;
      docDir = this.specDir;
    }
    if (!docDir) {
      docDir = path.dirname(docPath);
    }
    if (filterType === "all") {
      delete options.filter;
    }

    const allRefsRemoteRelative = jsonRefs.findRefs(doc, options);
    const e = openapiToolsCommon.mapEntries(
      allRefsRemoteRelative as openapiToolsCommon.StringMap<RefDetails>
    );
    const promiseFactories = e
      .map((ref) => async () => {
        const [refName, refDetails] = ref;
        return this.resolveRelativeReference(refName, refDetails, doc, docPath, suppression);
      })
      .toArray();

    if (promiseFactories.length) {
      await utils.executePromisesSequentially(promiseFactories);
    }
  }

  /**
   * Merges the x-ms-paths object into the paths object in swagger spec. The method assumes that the
   * paths present in "x-ms-paths" and "paths" are unique. Hence it does a simple union.
   */
  private unifyXmsPaths(): void {
    // unify x-ms-paths into paths
    const xmsPaths = this.specInJson["x-ms-paths"];
    const paths = this.specInJson.paths as PathsObject;
    if (
      xmsPaths &&
      xmsPaths instanceof Object &&
      openapiToolsCommon.toArray(openapiToolsCommon.keys(xmsPaths)).length > 0
    ) {
      for (const [property, v] of openapiToolsCommon.mapEntries(xmsPaths)) {
        paths[property] = v;
      }
      this.specInJson.paths = utils.mergeObjects(xmsPaths, paths);
    }
  }

  /**
   * Resolves the relative reference in the provided object. If the object to be resolved contains
   * more relative references then this method will call resolveRelativePaths
   *
   * @param refName the reference name/location that has a relative reference
   *
   * @param refDetails the value or the object that the refName points at
   *
   * @param doc the doc in which the refName exists
   *
   * @param docPath the absolute (local|remote) path of the doc
   *
   * @return undefined the modified object
   */
  private async resolveRelativeReference(
    refName: string,
    refDetails: RefDetails,
    doc: unknown,
    docPath: string | undefined,
    suppression: Suppression | undefined
  ): Promise<void> {
    if (!refName || (refName && typeof refName.valueOf() !== "string")) {
      throw new Error('refName cannot be null or undefined and must be of type "string".');
    }

    if (!refDetails || (refDetails && !(refDetails instanceof Object))) {
      throw new Error('refDetails cannot be null or undefined and must be of type "object".');
    }

    if (!doc || (doc && !(doc instanceof Object))) {
      throw new Error('doc cannot be null or undefined and must be of type "object".');
    }

    if (!docPath || (docPath && typeof docPath.valueOf() !== "string")) {
      throw new Error('docPath cannot be null or undefined and must be of type "string".');
    }

    const node = refDetails.def;
    const slicedRefName = refName.slice(1);
    const reference = node.$ref;
    const parsedReference = utils.parseReferenceInSwagger(reference);
    const docDir = path.dirname(docPath);

    if (parsedReference.filePath) {
      const regexFilePath = new RegExp("^[.\\w\\\\\\/].*.[A-Za-z]+$");
      if (!regexFilePath.test(parsedReference.filePath)) {
        throw new Error(`${node.$ref} isn't a valid local reference file.`);
      }
      // assuming that everything in the spec is relative to it, let us join the spec directory
      // and the file path in reference.
      docPath = utils.joinPath(docDir, parsedReference.filePath);
    }

    if (parsedReference.localReference) {
      await this.resolveLocalReference(
        slicedRefName,
        doc,
        docPath,
        node,
        parsedReference.localReference,
        suppression
      );
    } else {
      // Since there is no local reference we will replace the key in the object with the parsed
      // json (relative) file it is referring to.
      await this.resolveRemoteReference(slicedRefName, doc, docPath, suppression);
    }
  }

  /**
   * Resolves references local to the file.
   */
  private async resolveLocalReference(
    slicedRefName: string,
    doc: unknown,
    docPath: string,
    node: { $ref: string },
    localReference: utils.LocalReference,
    suppression: Suppression | undefined
  ) {
    // resolve the local reference.
    // make the reference local to the doc being processed
    const result = await jsonUtils.parseJson(
      suppression,
      docPath,
      this.reportError,
      this.docsCache
    );

    node.$ref = localReference.value;
    // TODO: doc should have a type
    utils.setObject(doc as any, slicedRefName, node);
    const slicedLocalReferenceValue = localReference.value.slice(1);
    let referencedObj = this.visitedEntities[slicedLocalReferenceValue];
    if (!referencedObj) {
      // We get the definition/parameter from the relative file and then add it (make it local)
      // to the doc (i.e. self.specInJson) being processed.
      referencedObj = utils.getObject(result, slicedLocalReferenceValue) as SchemaObject;
      utils.setObject(this.specInJson, slicedLocalReferenceValue, referencedObj);
      this.visitedEntities[slicedLocalReferenceValue] = referencedObj;
      await this.resolveRelativePaths(suppression, referencedObj, docPath, "all");
      // After resolving a model definition, if there are models that have an allOf on that model
      // definition.
      // It may be possible that those models are not being referenced anywhere. Hence, we must
      // ensure that they are consumed as well. Example model "CopyActivity" in file
      // arm-datafactory/2017-03-01-preview/swagger/entityTypes/Pipeline.json is having an allOf
      // on model "Activity". Spec "datafactory.json" has references to "Activity" in
      // Pipeline.json but there are no references to "CopyActivity". The following code, ensures
      // that we do not forget such models while resolving relative swaggers.
      if (result && result.definitions) {
        const definitions = result.definitions;
        const unresolvedDefinitions: Array<() => Promise<void>> = [];

        const processDefinition = (defEntry: openapiToolsCommon.MapEntry<SchemaObject>) => {
          const defName = defEntry[0];
          const def = defEntry[1];

          unresolvedDefinitions.push(async () => {
            const allOf = def.allOf;
            if (allOf) {
              const matchFound = allOf.some(() => !this.visitedEntities[`/definitions/${defName}`]);
              if (matchFound) {
                const slicedDefinitionRef = `/definitions/${defName}`;
                const definitionObj = definitions[defName];
                utils.setObject(this.specInJson, slicedDefinitionRef, definitionObj);
                this.visitedEntities[slicedDefinitionRef] = definitionObj;
                await this.resolveRelativePaths(suppression, definitionObj, docPath, "all");
              }
            }
          });
        };

        for (const entry of openapiToolsCommon.mapEntries(result.definitions)) {
          processDefinition(entry);
        }

        await utils.executePromisesSequentially(unresolvedDefinitions);
      }
    }
  }

  /**
   * Resolves remote references for the document
   */
  private async resolveRemoteReference(
    slicedRefName: string,
    doc: unknown,
    docPath: string,
    suppression: Suppression | undefined
  ) {
    const regex = /.*x-ms-examples.*/gi;
    if (this.options.shouldResolveXmsExamples || slicedRefName.match(regex) === null) {
      const result = await jsonUtils.parseJson(
        suppression,
        docPath,
        this.reportError,
        this.docsCache
      );
      const resultWithReferenceDocPath: any = result;
      resultWithReferenceDocPath.docPath = docPath;

      // We set a function `() => result` instead of an object `result` to avoid
      // reference resolution in the examples.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      utils.setObject(doc as any, slicedRefName, () => resultWithReferenceDocPath);
    } else {
      if (jsonPointer.has(doc as any, slicedRefName)) {
        jsonPointer.remove(doc as any, slicedRefName);
      }
    }
  }

  /**
   * Resolves the "allOf" array present in swagger model definitions by composing all the properties
   * of the parent model into the child model.
   */
  private resolveAllOfInDefinitions(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions as DefinitionsObject;
    for (const [modelName, model] of openapiToolsCommon.mapEntries(definitions)) {
      const modelRef = "/definitions/" + modelName;
      this.resolveAllOfInModel(model, modelRef);
    }
  }

  /**
   * Resolves the "allOf" array present in swagger model definitions by composing all the properties
   * of the parent model into the child model.
   */
  private resolveAllOfInModel(model: SchemaObject, modelRef: string | undefined) {
    const spec = this.specInJson;

    if (!model || (model && typeof model !== "object")) {
      throw new Error(`model cannot be null or undefined and must of type "object".`);
    }

    if (!modelRef || (modelRef && typeof modelRef.valueOf() !== "string")) {
      throw new Error(`model cannot be null or undefined and must of type "string".`);
    }

    if (modelRef.startsWith("#")) {
      modelRef = modelRef.slice(1);
    }

    if (!this.resolvedAllOfModels[modelRef]) {
      if (model && model.allOf) {
        model.allOf.forEach((item) => {
          const ref = item.$ref;
          const slicedRef = ref ? ref.slice(1) : undefined;
          const referencedModel =
            slicedRef === undefined ? item : (utils.getObject(spec, slicedRef) as SchemaObject);
          if (referencedModel.allOf) {
            this.resolveAllOfInModel(referencedModel, slicedRef);
          }
          model = this.mergeParentAllOfInChild(referencedModel, model);
          this.resolvedAllOfModels[slicedRef as string] = referencedModel;
        });
      } else {
        this.resolvedAllOfModels[modelRef] = model;
        return model;
      }
    }

    return undefined;
  }

  /**
   * Merges the properties of the parent model into the child model.
   *
   * @param {object} parent object to be merged. Example: "Resource".
   *
   * @param {object} child object to be merged. Example: "Storage".
   *
   * @return {object} returns the merged child object
   */
  private mergeParentAllOfInChild(parent: SchemaObject, child: SchemaObject): SchemaObject {
    if (!parent || (parent && typeof parent !== "object")) {
      throw new Error(`parent must be of type "object".`);
    }
    if (!child || (child && typeof child !== "object")) {
      throw new Error(`child must be of type "object".`);
    }
    // merge the parent (Resource) model's properties into the properties
    // of the child (StorageAccount) model.
    if (!parent.properties) {
      parent.properties = {};
    }
    if (!child.properties) {
      child.properties = {};
    }
    child.properties = utils.mergeObjects(parent.properties, child.properties);
    // merge the array of required properties
    if (parent.required) {
      if (!child.required) {
        child.required = [];
      }
      child.required = [...new Set([...parent.required, ...child.required])];
    }
    // merge x-ms-azure-resource
    if (parent["x-ms-azure-resource"]) {
      child["x-ms-azure-resource"] = parent["x-ms-azure-resource"];
    }
    return child;
  }

  /**
   * Deletes all the references to allOf from all the model definitions in the swagger spec.
   */
  private deleteReferencesToAllOf(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions as DefinitionsObject;
    for (const model of openapiToolsCommon.values(definitions)) {
      if (model.allOf) {
        delete model.allOf;
      }
    }
  }

  /**
   * Sets additionalProperties to false if additionalProperties is not defined.
   */
  private setAdditionalPropertiesFalse(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions as DefinitionsObject;

    for (const model of openapiToolsCommon.values(definitions)) {
      if (
        !model.additionalProperties &&
        !(
          !model.properties ||
          (model.properties &&
            openapiToolsCommon.toArray(openapiToolsCommon.keys(model.properties)).length === 0)
        )
      ) {
        model.additionalProperties = false;
      }
    }
  }

  /**
   * Resolves the parameters provided in 'x-ms-parameterized-host'
   * extension by adding those parameters as local parameters to every operation.
   *
   * ModelValidation:
   * This step should only be performed for model validation as we need to
   * make sure that the examples contain correct values for parameters
   * defined in 'x-ms-parameterized-host'.hostTemplate. Moreover, they are a
   * part of the baseUrl.
   *
   * SemanticValidation:
   * This step should not be performed for semantic validation, otherwise there will
   * be a mismatch between the number of path parameters provided in the operation
   * definition and the number of parameters actually present in the path template.
   */
  private resolveParameterizedHost(): void {
    const spec = this.specInJson;
    const parameterizedHost = spec[C.xmsParameterizedHost];
    const hostParameters = parameterizedHost ? parameterizedHost.parameters : null;
    if (parameterizedHost && hostParameters) {
      const paths = spec.paths;
      for (const verbs of openapiToolsCommon.values(paths)) {
        for (const operation of getOperations(verbs)) {
          let operationParameters = operation.parameters;
          if (!operationParameters) {
            operationParameters = [];
          }
          // merge host parameters into parameters for that operation.
          operation.parameters = operationParameters.concat(hostParameters);
        }
      }
    }
  }

  /**
   * Resolves entities (parameters, definitions, model properties, etc.) in the spec that are true
   * objects.
   * i.e `"type": "object"` and `"properties": {}` or `"properties"` is absent or the entity has
   * "additionalProperties": { "type": "object" }.
   */
  private resolvePureObjects(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions;

    // scan definitions and properties of every model in definitions
    for (const model of openapiToolsCommon.values(definitions)) {
      utils.relaxModelLikeEntities(model);
    }

    const resolveOperation = (operation: OperationObject) => {
      // scan every parameter in the operation
      const consumes = _.isUndefined(operation.consumes)
        ? _.isUndefined(spec.consumes)
          ? ["application/json"]
          : spec.consumes
        : operation.consumes;

      const produces = _.isUndefined(operation.produces)
        ? _.isUndefined(spec.produces)
          ? ["application/json"]
          : spec.produces
        : operation.produces;

      const octetStream = (elements: string[]) =>
        elements.some((e) => e.toLowerCase() === "application/octet-stream");

      const resolveParameter2 = (param: ParameterObject) => {
        if (param.in && param.in === "body" && param.schema && !octetStream(consumes)) {
          param.schema = utils.relaxModelLikeEntities(param.schema);
        } else {
          param = utils.relaxEntityType(param, param.required);
        }
      };

      if (operation.parameters) {
        operation.parameters.forEach(resolveParameter2);
      }
      // scan every response in the operation
      for (const response of openapiToolsCommon.values(operation.responses)) {
        if (response.schema && !octetStream(produces) && response.schema.type !== "file") {
          response.schema = utils.relaxModelLikeEntities(response.schema);
        }
      }
    };

    const resolveParameter = (param: ParameterObject) => {
      if (param.in && param.in === "body" && param.schema) {
        param.schema = utils.relaxModelLikeEntities(param.schema);
      } else {
        param = utils.relaxEntityType(param, param.required);
      }
    };

    // scan every operation
    for (const pathObj of openapiToolsCommon.values(spec.paths)) {
      for (const operation of getOperations(pathObj)) {
        resolveOperation(operation);
      }
      // scan path level parameters if any
      if (pathObj.parameters) {
        pathObj.parameters.forEach(resolveParameter);
      }
    }
    // scan global parameters
    const parameters = spec.parameters as ParametersDefinitionsObject;
    for (const [paramName, parameter] of openapiToolsCommon.mapEntries(parameters)) {
      if (parameter.in && parameter.in === "body" && parameter.schema) {
        parameter.schema = utils.relaxModelLikeEntities(parameter.schema);
      }
      parameters[paramName] = utils.relaxEntityType(parameter, parameter.required);
    }
  }

  /**
   * Resolves the discriminator by replacing all the references to the parent model with a oneOf
   * array containing
   * references to the parent model and all its child models. It also modifies the discriminator
   * property in
   * the child models by making it a constant (enum with one value) with the value expected for that
   * model
   * type on the wire.
   * For example: There is a model named "Animal" with a discriminator as "animalType". Models like
   * "Cat", "Dog",
   * "Tiger" are children (having "allof": [ { "$ref": "#/definitions/Animal" } ] on) of "Animal" in
   *  the swagger spec.
   *
   * - This method will replace all the locations in the swagger spec that have a reference to the
   * parent model "Animal" ("$ref": "#/definitions/Animal") except the allOf reference with a oneOf
   * reference
   * "oneOf": [ { "$ref": "#/definitions/Animal" }, { "$ref": "#/definitions/Cat" }, { "$ref":
   * "#/definitions/Dog" }, { "$ref": "#/definitions/Tiger" } ]
   *
   * - It will also add a constant value (name of that animal on the wire or the value provided by
   * "x-ms-discriminator-value")
   * to the discrimiantor property "animalType" for each of the child models.
   * For example:  the Cat model's discriminator property will look like:
   * "Cat": { "required": [ "animalType" ], "properties": { "animalType": { "type": "string",
   * "enum": [ "Cat" ] },  . . } }.
   */
  private resolveDiscriminator(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions as DefinitionsObject;
    const subTreeMap = new Map();
    const references = jsonRefs.findRefs(spec);

    for (const modelEntry of openapiToolsCommon.mapEntries(definitions)) {
      const modelName = modelEntry[0];
      const model = modelEntry[1];

      const discriminator = model.discriminator;
      if (discriminator) {
        let rootNode = subTreeMap.get(modelName);
        if (!rootNode) {
          rootNode = this.createPolymorphicTree(modelName, discriminator, subTreeMap);
        }
        this.updateReferencesWithOneOf(subTreeMap, references);
      }
    }
  }

  /**
   * Resolves all properties in models or responses that have a "type" defined, so that if the
   * property
   * is marked with "x-nullable", we'd honor it: we'd relax the type to include "null" if value is
   * true, we won't if value is false.
   * If the property does not have the "x-nullable" extension, then if not required, we'll relax
   * the type to include "null"; if required we won't.
   * The way we're relaxing the type is to have the model be a "oneOf" array with one value being
   * the original content of the model and the second value "type": "null".
   */
  private resolveNullableTypes(): void {
    const spec = this.specInJson;
    const definitions = spec.definitions as DefinitionsObject;

    // scan definitions and properties of every model in definitions
    for (const defEntry of openapiToolsCommon.mapEntries(definitions)) {
      const defName = defEntry[0];
      const model = defEntry[1];

      definitions[defName] = utils.allowNullableTypes(model);
    }
    // scan every operation response
    for (const pathObj of openapiToolsCommon.values(spec.paths)) {
      // need to handle parameters at this level
      if (pathObj.parameters) {
        pathObj.parameters = openapiToolsCommon.arrayMap(
          pathObj.parameters,
          utils.allowNullableParams
        );
      }
      for (const operation of getOperations(pathObj)) {
        // need to account for parameters, except for path parameters
        if (operation.parameters) {
          operation.parameters = openapiToolsCommon.arrayMap(
            operation.parameters,
            utils.allowNullableParams
          );
        }
        // going through responses
        for (const response of openapiToolsCommon.values(operation.responses)) {
          if (response.schema && response.schema.type !== "file") {
            response.schema = utils.allowNullableTypes(response.schema);
          }
        }
      }
    }

    // scan parameter definitions
    const parameters = spec.parameters as ParametersDefinitionsObject;
    for (const [parameterName, parameter] of openapiToolsCommon.mapEntries(parameters)) {
      parameters[parameterName] = utils.allowNullableParams(parameter);
    }
  }

  /**
   * Updates the reference to a parent node with a oneOf array containing a reference to the parent
   * and all its children.
   *
   * @param {Map<string, PolymorphicTree>} subTreeMap - A map containing a reference to a node in
   *    the PolymorphicTree.
   * @param {object} references - This object is the output of findRefs function from "json-refs"
   * library. Please refer
   * to the documentation of json-refs over
   * [here](https://bit.ly/2sw5MOa)
   * for detailed structure of the object.
   */
  private updateReferencesWithOneOf(
    subTreeMap: Map<string, PolymorphicTree>,
    references: openapiToolsCommon.StringMap<jsonRefs.UnresolvedRefDetails>
  ): void {
    const spec = this.specInJson;

    for (const node of subTreeMap.values()) {
      // Have to process all the non-leaf nodes only
      if (node.children.size > 0) {
        const locationsToBeUpdated = [];
        const modelReference = `#/definitions/${node.name}`;
        // Create a list of all the locations where the current node is referenced
        for (const [key, value] of openapiToolsCommon.mapEntries(references)) {
          if (
            value.uri === modelReference &&
            key.indexOf("allOf") === -1 &&
            key.indexOf("oneOf") === -1
          ) {
            locationsToBeUpdated.push(key);
          }
        }
        // Replace the reference to that node in that location with a oneOf array
        // containing reference to the node and all its children.
        for (const location of locationsToBeUpdated) {
          const slicedLocation = location.slice(1);
          const obj = utils.getObject(spec, slicedLocation) as any;
          if (obj) {
            if (obj.$ref) {
              delete obj.$ref;
            }
            obj.oneOf = [...this.buildOneOfReferences(node)];
            utils.setObject(spec, slicedLocation, obj);
          }
        }
      }
    }
  }

  /**
   * Creates a PolymorphicTree for a given model in the inheritance chain
   *
   * @param {string} name- Name of the model for which the tree needs to be created.
   * @param {string} discriminator- Name of the property that is marked as the discriminator.
   * @param {Map<string, PolymorphicTree>} subTreeMap- A map that stores a reference to
   * PolymorphicTree for a given model in the inheritance chain.
   * @returns {PolymorphicTree} rootNode- A PolymorphicTree that represents the model in the
   * inheritance chain.
   */
  private createPolymorphicTree(
    name: string,
    discriminator: string,
    subTreeMap: Map<string, PolymorphicTree>
  ): PolymorphicTree {
    if (
      name === null ||
      name === undefined ||
      typeof name.valueOf() !== "string" ||
      !name.trim().length
    ) {
      throw new Error(
        "name is a required property of type string and it cannot be an empty string."
      );
    }

    if (
      discriminator === null ||
      discriminator === undefined ||
      typeof discriminator.valueOf() !== "string" ||
      !discriminator.trim().length
    ) {
      throw new Error(
        "discriminator is a required property of type string and it cannot be an empty string."
      );
    }

    if (subTreeMap === null || subTreeMap === undefined || !(subTreeMap instanceof Map)) {
      throw new Error("subTreeMap is a required property of type Map.");
    }

    const rootNode = new PolymorphicTree(name);
    const definitions = this.specInJson.definitions as DefinitionsObject;

    // Adding the model name or it's discriminator value as an enum constraint with one value
    // (constant) on property marked as discriminator
    const definition = definitions[name];
    if (definition && definition.properties) {
      // all derived types should have `"type": "object"`.
      // otherwise it may pass validation for other types, such as `string`.
      // see also https://github.com/Azure/oav/issues/390
      definition.type = "object";
      const d = definition.properties[discriminator];
      if (d) {
        const required = definition.required;
        if (!openapiToolsCommon.isArray(required)) {
          definition.required = [discriminator];
        } else if (required.find((v) => v === discriminator) === undefined) {
          definition.required = [...required, discriminator];
        }
        const val = definition["x-ms-discriminator-value"] || name;
        // Ensure that the property marked as a discriminator has only one value in the enum
        // constraint for that model and it
        // should be the one that is the model name or the value indicated by
        // x-ms-discriminator-value. This will make the discriminator
        // property a constant (in json schema terms).
        if (d.$ref) {
          // When the discriminator enum is null and point to the nested reference,
          // we need to set discriminator enum value to the nested reference enum
          if (!d.enum) {
            const refDefinition = definitions[d.$ref.substring(d.$ref.lastIndexOf("/") + 1)];
            if (refDefinition) {
              d.enum = refDefinition.enum;
            }
          }
          delete d.$ref;
        }
        const xMsEnum = d["x-ms-enum"];
        if (xMsEnum !== undefined) {
          // if modelAsString is set to `true` then validator will always succeeded on any string.
          // Because of this, we have to set it to `false`.
          openapiToolsCommon.asMutable(xMsEnum).modelAsString = false;
        }
        // We will set "type" to "string". It is safe to assume that properties marked as
        // "discriminator" will be of type "string"
        // as it needs to refer to a model definition name. Model name would be a key in the
        // definitions object/dictionary in the
        // swagger spec. keys would always be a string in a JSON object/dictionary.
        if (!d.type) {
          d.type = "string";
        }
        // For base class model, set the discriminator value to the base class name plus the origin enum values
        if (definition.discriminator && d.enum) {
          const baseClassDiscriminatorValue = d.enum;
          if (d.enum.indexOf(val) === -1) {
            d.enum = [`${val}`, ...baseClassDiscriminatorValue];
          }
        } else {
          d.enum = [`${val}`];
        }
      }
    }

    const children = this.findChildren(name);
    for (const childName of children) {
      const childObj = this.createPolymorphicTree(childName, discriminator, subTreeMap);
      rootNode.addChildByObject(childObj);
    }
    // Adding the created sub tree in the subTreeMap for future use.
    subTreeMap.set(rootNode.name, rootNode);
    return rootNode;
  }

  /**
   * Finds children of a given model in the inheritance chain.
   *
   * @param {string} name- Name of the model for which the children need to be found.
   * @returns {Set} result- A set of model names that are the children of the given model in the
   *    inheritance chain.
   */
  private findChildren(name: string): Set<string> {
    if (
      name === null ||
      name === undefined ||
      typeof name.valueOf() !== "string" ||
      !name.trim().length
    ) {
      throw new Error(
        "name is a required property of type string and it cannot be an empty string."
      );
    }
    const definitions = this.specInJson.definitions as DefinitionsObject;
    const reference = `#/definitions/${name}`;
    const result = new Set<string>();

    const findReferences = (definitionName: string) => {
      const definition = definitions[definitionName];
      if (definition && definition.allOf) {
        definition.allOf.forEach((item) => {
          // TODO: What if there is an inline definition instead of $ref
          if (item.$ref && item.$ref === reference) {
            log.debug(`reference found: ${reference} in definition: ${definitionName}`);
            result.add(definitionName);
          }
        });
      }
    };

    for (const definitionName of openapiToolsCommon.keys(definitions)) {
      findReferences(definitionName);
    }

    return result;
  }

  /**
   * Builds the oneOf array of references that comprise of the parent and its children.
   *
   * @param {PolymorphicTree} rootNode- A PolymorphicTree that represents the model in the
   *    inheritance chain.
   * @returns {PolymorphicTree} An array of reference objects that comprise of the
   *    parent and its children.
   */
  private buildOneOfReferences(rootNode: PolymorphicTree): Set<SchemaObject> {
    let result = new Set<SchemaObject>();
    result.add({ $ref: `#/definitions/${rootNode.name}` });
    for (const enObj of rootNode.children.values()) {
      if (enObj) {
        result = new Set([...result, ...this.buildOneOfReferences(enObj)]);
      }
    }
    return result;
  }

  /**
   * Check if exist undefined within-document reference
   */
  private verifyInternalReference() {
    const errsDetail: any[] = [];
    const unresolvedRefs = jsonUtils.findUndefinedWithinDocRefs(this.specInJson);
    unresolvedRefs.forEach((pathStr, ref) => {
      const err: any = {};
      err.path = pathStr.join(".");
      err.message = `JSON Pointer points to missing location:${ref}`;
      errsDetail.push(err);
    });

    if (errsDetail.length) {
      const err: any = C.ErrorCodes.RefNotFoundError;
      err.message = "Reference could not be resolved";
      err.innerErrors = errsDetail;
      throw err;
    }
  }
}
