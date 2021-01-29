const { Http } = require("ogd-sdk-http-client");

const serialize = (name, json) => {
  if (
    json == null ||
    json == "" ||
    (Array.isArray(json) && json.length === 0) ||
    (typeof json === "object" && Object.keys(json).length === 0)
  ) {
    return "<EMPTY>";
  }

  try {
    return Buffer.from(JSON.stringify(json)).toString("base64");
  } catch (error) {
    console.warn(`FAILED TO SERIALIZE GQL ${name}:`, error);
    return "<FAILED>";
  }
};

/**
 * Initialize the plugin to install our request handler.
 *
 * ogdIngressUrl: <string> URL Endpoint for the OGD data collection service.
 * ogdToken: <string> Unique token provided to you by OGD.
 */
function OGDApolloServerPlugin({ ogdIngressUrl, ogdToken, disable } = {}) {
  // We should NEVER explode someone's GraphQL instance. Therefore, we provide
  // an "error" instance of this plugin.
  let __ogdInstance = null;
  let __ogdEmptyResponse = Promise.resolve({});

  if (disable === true || ogdToken.toUpperCase() === "DISABLED") {
    __ogdInstance = (ignoredHttpCallOptions) => __ogdEmptyResponse;
  }

  try {
    __ogdInstance =
      __ogdInstance == null ? Http.make(ogdIngressUrl) : __ogdInstance;
  } catch (error) {
    console.warn("Failed to instantiate the OGD SDK:", error);

    __ogdInstance = (httpCallOptions) => {
      console.warn(
        ```
        OGD INSTANCE IS NOT PROPERLY CONFIGURED

        If I was properly configured I would attempt to make an HTTP request
        using the following information:

        METHOD: ${httpCallOptions.method}
        PATH: ${httpCallOptions.path}
        BODY: ${JSON.stringify(httpCallOptions.body)}
      ```
      );

      return __ogdEmptyResponse;
    };
  }

  const ogd = __ogdInstance;

  return {
    serverWillStart() {
      return null;
    },

    requestDidStart() {
      return {
        didResolveSource: null,
        parsingDidStart: null,
        validationDidStart: null,

        /* OGD Extension Point
         * We are going to use this particular life cycle event because it's
         * possible to inject a response here.  This way we have the ability
         * to override any validation errors with OGD errors.
         *
         * The responseForOperation event is fired immediately before GraphQL
         * execution would take place. If its return value resolves to a non-null
         * GraphQLResponse, that result is used instead of executing the query.
         * Hooks from different plugins are invoked in series, and the first
         * non-null response is used.
         */
        responseForOperation(ctx) {
          const {
            context: { req },

            queryHash,
            source,
            operation,

            request: { variables, extensions },
          } = ctx;

          const body = {
            graphql: {
              queryHash,
              querySource: source,
              operationKind: operation.kind,
              operationType: operation.operation,
              operationName: operation.name.value,
              operationSerialized: serialize("operation", operation),
              variablesSerialized: serialize("variables", variables),
              extensionsSerialized: serialize("extensions", extensions),
            },
            headers: {
              ["x-original-method"]: req.method,
              ["x-original-url"]: `${req.protocol}://${req.headers.host}${req.originalUrl}`,
            },
          };

          ogd({ method: Http.Method.POST, path: "/sdk/graphql", body }).catch(
            (error) => {
              let textFn =
                typeof error.text === "function"
                  ? error.text
                  : () => Promise.resolve("UNKNOWN");

              textFn()
                .then((text) =>
                  console.error("Failed to upload OGD stats:", text, error)
                )
                .catch((error) =>
                  console.error("Unknown Response Type:", error)
                );
            }
          );

          return null;
        },

        executionDidStart: null,
        didEncounterErorrs: null,
        willSendResponse: null,
      };
    },
  };
}

module.exports = {
  OGDApolloServerPlugin,
};
