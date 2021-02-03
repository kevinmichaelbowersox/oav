import "reflect-metadata";

import { dirname } from "path";
import { getDefaultAzureCredential } from "@azure/identity";
import { getAutorestConfig } from "../util/getAutorestConfig";
import { TestResourceLoader } from "./testResourceLoader";
import { TestScenarioRunner } from "./testScenarioRunner";
import { VariableEnv } from "./variableEnv";
import { TestScenarioRestClient } from "./testScenarioRestClient";

const main = async () => {
  const readmeMd: string =
    "/home/htc/azure-rest-api-specs/specification/containerservice/resource-manager/readme.md";
  const argv = {
    ["try-require"]: "readme.test.md",
    tag: "package-2020-07",
  };

  const autorestConfig = await getAutorestConfig(argv, readmeMd);
  const swaggerFilePaths: string[] = autorestConfig["input-file"];
  const fileRoot = dirname(readmeMd);

  console.log("input-file:");
  console.log(swaggerFilePaths);

  const loader = TestResourceLoader.create({
    useJsonParser: false,
    checkUnderFileRoot: false,
    fileRoot,
    swaggerFilePaths,
  });

  const testDef = await loader.load(
    "Microsoft.ContainerService/stable/2020-07-01/test-scenarios/testAks.yml"
  );

  console.log(testDef);

  const env = new VariableEnv();
  env.setBatch({
    subscriptionId: "db5eb68e-73e2-4fa8-b18a-46cd1be4cce5",
    location: "eastasia",
  });

  const runner = new TestScenarioRunner({
    jsonLoader: loader.jsonLoader,
    env,
    client: new TestScenarioRestClient(getDefaultAzureCredential(), {}),
  });

  try {
    for (const scenario of testDef.testScenarios) {
      await runner.executeScenario(scenario);
    }
  } catch (e) {
    console.log(e.message, e.stack);
  } finally {
    console.timeLog("TestLoad");
    await runner.cleanAllTestScope();
  }
};

console.time("TestLoad");
console.log("Start");

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    console.timeEnd("TestLoad");
  });
