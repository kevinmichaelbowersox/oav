/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 *
 * Code generated by Microsoft (R) AutoRest Code Generator.
 * Changes may cause incorrect behavior and will be lost if the code is
 * regenerated.
 */

/**
 * @class
 * Initializes a new instance of the LiveRequest class.
 * @constructor
 * Properties of the request.
 *
 * @member {object} headers Headers of the request.
 *
 * @member {string} method Http verb of the request. Possible values include:
 * 'GET', 'PUT', 'PATCH', 'POST', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'
 *
 * @member {string} url Url of the request.
 *
 * @member {object} [body] Parsed body of the request as a JSON.
 *
 */
class LiveRequest {
  constructor() {
  }

  /**
   * Defines the metadata of LiveRequest
   *
   * @returns {object} metadata of LiveRequest
   *
   */
  mapper() {
    return {
      required: false,
      serializedName: 'LiveRequest',
      type: {
        name: 'Composite',
        className: 'LiveRequest',
        modelProperties: {
          headers: {
            required: true,
            serializedName: 'headers',
            type: {
              name: 'Dictionary',
              value: {
                  required: false,
                  serializedName: 'StringElementType',
                  type: {
                    name: 'String'
                  }
              }
            }
          },
          method: {
            required: true,
            serializedName: 'method',
            type: {
              name: 'String'
            }
          },
          url: {
            required: true,
            serializedName: 'url',
            type: {
              name: 'String'
            }
          },
          body: {
            required: false,
            serializedName: 'body',
            type: {
              name: 'Object'
            }
          }
        }
      }
    };
  }
}

export = LiveRequest;
