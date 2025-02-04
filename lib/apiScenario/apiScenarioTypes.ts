import { HttpMethods } from "@azure/core-http";
import { Operation, SwaggerExample } from "../swagger/swaggerTypes";

//#region Common

type TransformRaw<T, Additional = {}, OptionalKey extends keyof T = never> = {
  [P in OptionalKey]?: T[P];
} &
  {
    [P in Exclude<keyof T, OptionalKey | keyof Additional>]-?: Exclude<T[P], undefined>;
  } &
  Additional;

export type RawVariableScope = {
  variables?: {
    [variableName: string]:
      | string
      | {
          type?: VariableType;
          defaultValue?: string;
        };
  };
};

export type VariableScope = {
  variables: { [variableName: string]: string };
  requiredVariables: string[];
  secretVariables: string[];
};

export type OutputVariables = {
  [variableName: string]: {
    type?: VariableType;
    fromResponse: string;
  };
};

//#endregion

//#region Step Base

type RawStepBase = RawVariableScope & {
  step: string;
  description?: string;
  outputVariables?: OutputVariables;
};

type StepBase = VariableScope & {
  isPrepareStep?: boolean;
  isCleanUpStep?: boolean;
};

type RawStepRestBase = RawStepBase & {
  statusCode?: number;
  resourceUpdate?: JsonPatchOp[];
  requestUpdate?: JsonPatchOp[];
  responseUpdate?: JsonPatchOp[];
};

export type Step = StepRestCall | StepArmTemplate | StepRawCall;
export type RawStep =
  | RawStepRestCall
  | RawStepRestOperation
  | RawStepArmTemplate
  | RawStepArmScript
  | RawStepRawCall;

//#endregion

//#region Step RestCall

export type RawStepRestCall = RawStepRestBase & {
  exampleFile: string;
  resourceName?: string;
};

export type StepRestCall = TransformRaw<
  RawStepRestCall,
  {
    type: "restCall";
    operationId: string;
    operation: Operation;
    exampleName: string;
    exampleFilePath?: string;
    requestParameters: SwaggerExample["parameters"];
    expectedResponse: SwaggerExample["responses"]["200"]["body"];
  } & StepBase,
  "exampleFile" | "resourceName" | "description"
>;

//#endregion

//#region Step Named Resource Operation
export type RawStepRestOperation = RawStepRestBase & {
  operationId: string;
  resourceName: string;
};
//#endregion

//#region Step Arm Script Template
export type RawStepArmScript = RawStepBase & {
  armDeploymentScript: string;
  arguments?: string;
  environmentVariables?: Array<{
    name: string;
    value: string;
  }>;
};
//#endregion

//#region Step Arm Template Deployment

export type RawStepArmTemplate = RawStepBase & {
  armTemplate: string;
};

export type StepArmTemplate = TransformRaw<
  RawStepArmTemplate,
  {
    type: "armTemplateDeployment";
    armTemplatePayload: ArmTemplate;
  } & StepBase,
  "description"
>;

export type VariableType = "string" | "secureString";

export type ArmTemplateVariableType =
  | "string"
  | "securestring"
  | "int"
  | "bool"
  | "object"
  | "secureObject"
  | "array";

export type ArmResource = {
  name: string;
  apiVersion: string;
  type: string;
  location?: string;
  properties?: object;
};

export type ArmDeploymentScriptResource = ArmResource & {
  type: "Microsoft.Resources/deploymentScripts";
  kind: "AzurePowerShell" | "AzureCLI";
  identity?: {
    type: "UserAssigned";
    userAssignedIdentities: {
      [name: string]: {};
    };
  };
  properties: {
    arguments?: string;
    azPowerShellVersion?: string;
    azCliVersion?: string;
    scriptContent: string;
    forceUpdateTag?: string;
    timeout?: string;
    cleanupPreference?: string;
    retentionInterval?: string;
    environmentVariables?: Array<{
      name: string;
      value?: string;
      secureValue?: string;
    }>;
  };
};

export type ArmTemplate = {
  $schema?: string;
  contentVersion?: string;
  parameters?: {
    [name: string]: {
      type: ArmTemplateVariableType;
      defaultValue?: any;
    };
  };
  outputs?: {
    [name: string]: {
      condition?: string;
      type: ArmTemplateVariableType;
    };
  };
  resources?: ArmResource[];
};

//#endregion

//#region Step Raw REST Call
export type RawStepRawCall = RawStepBase & {
  method: HttpMethods;
  rawUrl: string;
  requestHeaders: { [headName: string]: string };
  requestBody: string;
  statusCode?: number;
  expectedResponse?: string;
};

export type StepRawCall = TransformRaw<
  RawStepRawCall,
  {
    type: "rawCall";
  } & StepBase,
  "expectedResponse" | "description"
>;
//#endregion

//#region JsonPatchOp

export type JsonPatchOpAdd = {
  add: string;
  value: any;
};

export type JsonPatchOpRemove = {
  remove: string;
  oldValue?: any;
};

export type JsonPatchOpReplace = {
  replace: string;
  value: any;
  oldValue?: any;
};

export type JsonPatchOpCopy = {
  copy: string;
  from: string;
};

export type JsonPatchOpMove = {
  move: string;
  from: string;
};

export type JsonPatchOpTest = {
  test: string;
  value: any;
};

export type JsonPatchOp =
  | JsonPatchOpAdd
  | JsonPatchOpRemove
  | JsonPatchOpReplace
  | JsonPatchOpCopy
  | JsonPatchOpMove
  | JsonPatchOpTest;

//#endregion

//#region Scenario

export type RawScenario = RawVariableScope & {
  scenario: string;
  shareScope?: boolean;
  description?: string;
  steps: RawStep[];
};

export type Scenario = TransformRaw<
  RawScenario,
  {
    steps: Step[];
    _scenarioDef: ScenarioDefinition;
    _resolvedSteps: Step[];
  } & VariableScope
>;

//#endregion

//#region ScenarioDefinitionFile
export type RawScenarioDefinition = RawVariableScope & {
  scope?: "ResourceGroup";
  prepareSteps?: RawStep[];
  scenarios: RawScenario[];
  cleanUpSteps?: RawStep[];
};

export type ScenarioDefinition = TransformRaw<
  RawScenarioDefinition,
  {
    prepareSteps: Step[];
    scenarios: Scenario[];
    cleanUpSteps: Step[];
    _filePath: string;
  } & VariableScope
>;
//#endregion

//#region Runner specific types
export type RawReport = {
  executions: RawExecution[];
  timings: any;
  variables: any;
  testScenarioName?: string;
  metadata: any;
};

export type RawExecution = {
  request: RawRequest;
  response: RawResponse;
  annotation?: any;
};
export type RawRequest = {
  url: string;
  method: string;
  headers: { [key: string]: any };
  body: string;
};

export type RawResponse = {
  statusCode: number;
  headers: { [key: string]: any };
  body: string;
};

export type TestResources = {
  ["test-resources"]: Array<{ [key: string]: string }>;
};

//#endregion
