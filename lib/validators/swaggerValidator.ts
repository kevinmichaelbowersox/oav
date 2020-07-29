// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as amd from "@azure/openapi-markdown";
import * as json from "@ts-common/json";
import * as jsonParser from "@ts-common/json-parser";
import { StringMap } from "@ts-common/string-map";
import { setMutableProperty } from "@ts-common/property-set";
import * as C from "../util/constants";
import * as jsonUtils from "../util/jsonUtils";
import * as processErrors from "../util/processErrors";
import { CommonError } from "../util/commonError";
import { Headers } from "../templates/httpTemplate";
import { ModelValidation } from "../util/getErrorsFromModelValidation";

import { OperationResult } from "../util/scenarioReducer";
import { SwaggerLoader } from "../swagger/swaggerLoader";
import { SwaggerSpec } from "../swagger/swaggerTypes";
import { log } from "../util/logging";
import { getSuppressions } from "./suppressions";
import { getTitle } from "./specTransformer";
import * as specResolver from "./specResolver";

export interface ValidationEntry {
  code: string;
  error: string;
  errors: ValidationEntry[]; // for nested errors
  lineage: string[];
  message: string;
  name: string;
  params: any[];
  path: string[];
  schemaPath: string;
  schemaId: string;
}

export interface ValidationResults {
  errors: ValidationEntry[];
  warnings?: ValidationEntry[];
}

const ErrorCodes = C.ErrorCodes;

export interface Options extends specResolver.Options {
  readonly isPathCaseSensitive?: boolean;
  readonly loadSuppression?: boolean;
}

export interface ErrorCode {
  readonly name: string;
  readonly id: string;
}

export interface RequestValidation {
  request?: unknown;
  validationResult?: ValidationResults;
}

type ResponseValidation = StringMap<ValidationResults>;

export interface ValidationResult {
  exampleNotFound?: CommonError;
  scenarios?: ValidationResultScenarios;
  readonly requestValidation?: RequestValidation;
  readonly responseValidation?: ResponseValidation;
}

export interface ValidationResultScenarios {
  [name: string]: ValidationResult;
}

export interface SpecValidationResult extends ModelValidation {
  validityStatus: boolean;
  resolveSpec?: ValidationEntry;
}

export interface ExampleResponse {
  readonly headers: Headers;
  readonly body: unknown;
}

export interface CommonValidationResult {
  validityStatus: boolean;
  operations: StringMap<OperationResult | undefined>;
  resolveSpec?: ValidationEntry;
}

export interface ErrorParameters<TE extends CommonError> {
  code: ErrorCode;
  message: string;
  innerErrors?: null | TE[];
  skipValidityStatusUpdate?: boolean;
  source?: json.JsonObject;
}

/*
 * @class
 * Performs semantic and data validation of the given swagger spec.
 */
export class SwaggerValidator<T extends CommonValidationResult> {
  public specValidationResult: T;

  protected specInJson: SwaggerSpec | null = null;

  protected suppression?: amd.Suppression;

  private readonly options: Options;

  /*
   * @constructor
   * Initializes a new instance of the SpecValidator class.
   *
   * @param {string} specPath the (remote|local) swagger spec path
   *
   * @param {object} [specInJson] the parsed spec in json format
   *
   * @param {object} [options.shouldResolveRelativePaths] Should relative paths be resolved?
   * Default: true
   *
   * @param {object} [options.shouldResolveXmsExamples] Should x-ms-examples be resolved?
   * Default: true.
   * If options.shouldResolveRelativePaths is false then this option will also be false implicitly
   * and cannot be overridden.
   *
   * @param {object} [options.shouldResolveAllOf] Should allOf references be resolved? Default: true
   *
   * @param {object} [options.shouldResolveDiscriminator] Should discriminator be resolved?
   * Default: true
   *
   * @param {object} [options.shouldSetAdditionalPropertiesFalse] Should additionalProperties be
   * set to false? Default: true
   *
   * @param {object} [options.shouldResolvePureObjects] Should pure objects be resolved?
   * Default: true
   *
   * @param {object} [options.shouldResolveParameterizedHost] Should 'x-ms-parameterized-host' be
   * resolved? Default: true
   *
   * @param {object} [options.shouldResolveNullableTypes] Should we allow null values to match any
   * type? Default: true
   *
   * @param {object} [options.isPathCaseSensitive] Specifies if the paths should be considered case
   * sensitive. Default: true
   *
   * @return {object} An instance of the SpecValidator class.
   */
  public constructor(private specPath: string, options: Options) {
    if (
      specPath === null ||
      specPath === undefined ||
      typeof specPath.valueOf() !== "string" ||
      !specPath.trim().length
    ) {
      throw new Error(
        "specPath is a required parameter of type string and it cannot be an empty string."
      );
    }
    // If the spec path is a url starting with https://github then let us auto convert it to an
    // https://raw.githubusercontent url.
    if (specPath.startsWith("https://github")) {
      specPath = specPath.replace(
        /^https:\/\/(github.com)(.*)blob\/(.*)/gi,
        "https://raw.githubusercontent.com$2$3"
      );
    }
    this.specPath = specPath;
    const base: CommonValidationResult = {
      validityStatus: true,
      operations: {},
    };
    this.specValidationResult = base as T;
    if (!options) {
      options = {};
    }
    if (
      options.shouldResolveRelativePaths === null ||
      options.shouldResolveRelativePaths === undefined
    ) {
      options.shouldResolveRelativePaths = true;
    }

    this.options = options;
  }

  /*
   * Initializes the spec validator. Resolves the spec on different counts using the SpecResolver
   * and initializes the internal api validator.
   */
  public async initialize(swaggerLoader: SwaggerLoader): Promise<SwaggerSpec> {
    const errors: jsonParser.ParseError[] = [];
    // const reportError = (e: jsonParser.ParseError) => errors.push(e);
    try {
      this.specInJson = await swaggerLoader.loadSpec(this.specPath);
      if (this.options.loadSuppression) {
        this.suppression = await getSuppressions(this.specPath);
        jsonUtils.applySuppression(this.specInJson, this.specPath, this.suppression);
      }

      // TODO specResolver
      // const resolver = new specResolver.SpecResolver(
      //   this.specPath,
      //   this.specInJson,
      //   this.options,
      //   reportError,
      //   this.docsCache
      // );
      // this.specInJson = (await resolver.resolve(this.suppression)).specInJson;
    } catch (err) {
      if (typeof err === "object" && err.id && err.message) {
        this.specValidationResult.resolveSpec = err;
        throw err;
      }
      const e = this.constructErrorObject({
        code: ErrorCodes.InternalError,
        message: err.message,
        innerErrors: [err],
      });
      this.specValidationResult.resolveSpec = e;
      log.error(`${ErrorCodes.ResolveSpecError.name}: ${err.message}.`);
      log.error(err.stack);
      throw e;
    }
    if (errors.length > 0) {
      const err = errors[0];
      const e = this.constructErrorObject({
        code: ErrorCodes.JsonParsingError,
        message: err.message,
        innerErrors: errors,
      });
      this.specValidationResult.resolveSpec = e as any;
      log.error(`${ErrorCodes.ResolveSpecError.name}: ${err.message}.`);
    }

    return this.specInJson;
  }

  /*
   * Constructs the Error object and updates the validityStatus unless indicated to not update the
   * status.
   *
   * @param {string} code The Error code that uniquely identifiers the error.
   *
   * @param {string} message The message that provides more information about the error.
   *
   * @param {array} [innerErrors] An array of Error objects that specify inner details.
   *
   * @param {boolean} [skipValidityStatusUpdate] When specified a truthy value it will skip updating
   *    the validity status.
   *
   * @return {object} err Return the constructed Error object.
   */
  protected constructErrorObject<TE extends CommonError>({
    code,
    message,
    innerErrors,
    skipValidityStatusUpdate,
    source,
  }: ErrorParameters<TE>): TE {
    const err: TE = {
      code: code.name,
      id: code.id,
      message,
    } as any;
    setMutableProperty(err, "innerErrors", innerErrors ? innerErrors : undefined);
    if (!skipValidityStatusUpdate) {
      this.updateValidityStatus();
    }
    if (source !== undefined) {
      processErrors.setPositionAndUrl(err, getTitle(source));
    }
    return err;
  }

  /*
   * Updates the validityStatus of the internal specValidationResult based on the provided value.
   *
   * @param {boolean} value
   */
  protected updateValidityStatus(value?: boolean): void {
    this.specValidationResult.validityStatus = Boolean(value);
  }
}
