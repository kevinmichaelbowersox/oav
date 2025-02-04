import { Schema } from "../swagger/swaggerTypes";

export const ApiScenarioDefinition: Schema & {
  definitions: { [def: string]: Schema };
} = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["ResourceGroup"],
    },
    variables: {
      $ref: "#/definitions/Variables",
    },
    prepareSteps: {
      type: "array",
      description: "Prepare steps before executing scenarios",
      items: {
        $ref: "#/definitions/Step",
      },
    },
    scenarios: {
      type: "array",
      description: "API scenarios",
      items: {
        $ref: "#/definitions/Scenario",
      },
      minItems: 1,
    },
    cleanUpSteps: {
      type: "array",
      description: "Clean up steps after executing scenarios",
      items: {
        $ref: "#/definitions/Step",
      },
    },
  },
  required: ["scenarios"],
  additionalProperties: false,
  definitions: {
    Name: {
      type: "string",
      pattern: "^[A-Za-z_][A-Za-z0-9_-]*$",
    },
    JsonPointer: {
      type: "string",
      description: "JSON Pointer described by RFC 6901, e.g. /foo/bar",
      pattern: "^(/(([^/~])|(~[01]))*)*$",
    },
    Variables: {
      type: "object",
      propertyNames: {
        $ref: "#/definitions/Name",
      },
      additionalProperties: {
        oneOf: [
          {
            type: "string",
            description: "Default value of the variable",
          },
          {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["string", "secureString"],
                default: "string",
              },
              defaultValue: {
                type: "string",
                description: "Default value of the variable",
              },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    Scenario: {
      type: "object",
      properties: {
        scenario: {
          $ref: "#/definitions/Name",
          description: "Name of the scenario",
        },
        description: {
          type: "string",
          description: "A long description of the scenario",
        },
        variables: {
          $ref: "#/definitions/Variables",
        },
        shareScope: {
          type: "boolean",
          description: "Whether to share the scope and prepareSteps with other scenarios",
          default: true,
        },
        steps: {
          type: "array",
          items: {
            $ref: "#/definitions/Step",
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
    Step: {
      oneOf: [
        {
          $ref: "#/definitions/StepRestCall",
        },
        {
          $ref: "#/definitions/StepRestOperation",
        },
        {
          $ref: "#/definitions/StepArmTemplate",
        },
        {
          $ref: "#/definitions/StepArmDeploymentScript",
        },
        {
          $ref: "#/definitions/StepRawCall",
        },
      ],
    },
    StepBase: {
      properties: {
        step: {
          $ref: "#/definitions/Name",
          description: "Name of the step",
        },
        description: {
          type: "string",
          description: "A long description of the step",
        },
        variables: {
          $ref: "#/definitions/Variables",
        },
        outputVariables: {
          type: "object",
          propertyNames: {
            $ref: "#/definitions/Name",
          },
          additionalProperties: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["string", "secureString"],
                default: "string",
              },
              fromResponse: {
                type: "string",
              },
            },
          },
        },
      },
    },
    StepRestBase: {
      allOf: [
        {
          $ref: "#/definitions/StepBase",
        },
      ],
      properties: {
        resourceUpdate: {
          type: "array",
          description: "Update resource properties in body for both request and expected response",
          items: {
            $ref: "#/definitions/JsonPatchOp",
          },
          minItems: 1,
        },
        requestUpdate: {
          type: "array",
          description: "Update request parameters",
          items: {
            $ref: "#/definitions/JsonPatchOp",
          },
          minItems: 1,
        },
        responseUpdate: {
          type: "array",
          description: "Update expected response",
          items: {
            $ref: "#/definitions/JsonPatchOp",
          },
          minItems: 1,
        },
        statusCode: {
          type: "integer",
          description: "Expected response code",
          default: 200,
        },
      },
    },
    StepRestCall: {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/StepRestBase",
        },
      ],
      properties: {
        exampleFile: {
          type: "string",
        },
        resourceName: {
          $ref: "#/definitions/Name",
          description: "Name a resource for tracking",
        },
      },
      required: ["exampleFile"],
    },
    StepRestOperation: {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/StepRestBase",
        },
      ],
      properties: {
        operationId: {
          type: "string",
          description: "The operationId to perform on a tracking resource",
        },
        resourceName: {
          $ref: "#/definitions/Name",
          description: "Reference a tracking resource",
        },
      },
      required: ["operationId", "resourceName"],
    },
    StepArmTemplate: {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/StepBase",
        },
      ],
      properties: {
        armTemplate: {
          type: "string",
        },
      },
      required: ["armTemplate"],
    },
    StepArmDeploymentScript: {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/StepBase",
        },
      ],
      properties: {
        armDeploymentScript: {
          type: "string",
        },
        arguments: {
          type: "string",
        },
        environmentVariables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              value: {
                type: "string",
              },
            },
            required: ["name", "value"],
          },
        },
      },
      required: ["armDeploymentScript"],
    },
    StepRawCall: {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/StepBase",
        },
      ],
      properties: {
        method: {
          type: "string",
          enum: ["GET", "PUT", "PATCH", "POST", "DELETE", "OPTIONS", "HEAD"],
        },
        url: {
          type: "string",
        },
        requestHeaders: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        requestBody: {},
        statusCode: {
          type: "integer",
          description: "Expected response code",
          default: 200,
        },
        expectedResponse: {},
      },
      required: ["method", "url", "requestHeaders", "requestBody"],
    },
    JsonPatchOp: {
      type: "object",
      description: "Change a JSON document in a format described by RFC 6902",
      oneOf: [
        {
          $ref: "#/definitions/JsonPatchOpAdd",
        },
        {
          $ref: "#/definitions/JsonPatchOpRemove",
        },
        {
          $ref: "#/definitions/JsonPatchOpReplace",
        },
        {
          $ref: "#/definitions/JsonPatchOpCopy",
        },
        {
          $ref: "#/definitions/JsonPatchOpMove",
        },
        {
          $ref: "#/definitions/JsonPatchOpTest",
        },
      ],
    },
    JsonPatchOpAdd: {
      type: "object",
      required: ["add", "value"],
      properties: {
        add: {
          $ref: "#/definitions/JsonPointer",
        },
        value: {},
      },
      additionalProperties: false,
    },
    JsonPatchOpRemove: {
      type: "object",
      required: ["remove"],
      properties: {
        remove: {
          $ref: "#/definitions/JsonPointer",
        },
      },
      additionalProperties: false,
    },
    JsonPatchOpReplace: {
      type: "object",
      required: ["replace", "value"],
      properties: {
        replace: {
          $ref: "#/definitions/JsonPointer",
        },
        value: {},
      },
      additionalProperties: false,
    },
    JsonPatchOpCopy: {
      type: "object",
      required: ["copy", "from"],
      properties: {
        copy: {
          $ref: "#/definitions/JsonPointer",
        },
        from: {
          $ref: "#/definitions/JsonPointer",
        },
      },
      additionalProperties: false,
    },
    JsonPatchOpMove: {
      type: "object",
      required: ["move", "from"],
      properties: {
        move: {
          $ref: "#/definitions/JsonPointer",
        },
        from: {
          $ref: "#/definitions/JsonPointer",
        },
      },
      additionalProperties: false,
    },
    JsonPatchOpTest: {
      type: "object",
      required: ["test", "value"],
      properties: {
        test: {
          $ref: "#/definitions/JsonPointer",
        },
        value: {},
      },
      additionalProperties: false,
    },
  },
};
