import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const dokployGetMock = vi.fn();
const resolveServiceMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({ dokployGet: dokployGetMock }));
vi.mock("../../src/registry.js", () => ({
  resolveService: resolveServiceMock,
}));

const { deploymentsCommand, listDeployments } =
  await import("../../src/commands/deployments.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

const COMPOSE_REF = {
  kind: "compose" as const,
  id: "cmp_api_1",
  name: "api-example",
  status: "running",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

const APPLICATION_REF = {
  kind: "application" as const,
  id: "app_front_1",
  name: "front-example",
  status: "done",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

beforeEach(() => {
  dokployGetMock.mockReset();
  resolveServiceMock.mockReset();
});

describe("listDeployments", () => {
  it("reads deployment.allByCompose for a compose", async () => {
    dokployGetMock.mockResolvedValue(fixture("deployment-allByCompose.json"));

    const deployments = await listDeployments(CTX, COMPOSE_REF);

    expect(dokployGetMock).toHaveBeenCalledWith(
      CTX,
      "deployment.allByCompose",
      { composeId: "cmp_api_1" },
    );
    expect(deployments[0]?.deploymentId).toBe("dep_api_2");
  });

  it("reads application.one and sorts its nested deployments by date for an application", async () => {
    dokployGetMock.mockResolvedValue(fixture("application-one.json"));

    const deployments = await listDeployments(CTX, APPLICATION_REF);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "application.one", {
      applicationId: "app_front_1",
    });
    expect(deployments[0]?.deploymentId).toBe("dep_front_newest");
    expect(deployments[1]?.deploymentId).toBe("dep_front_older");
  });
});

describe("deploymentsCommand", () => {
  it("requires a service name", async () => {
    await expect(deploymentsCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("lists the deployment history newest first", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue(fixture("deployment-allByCompose.json"));

    const output = await deploymentsCommand(["api-example"], CTX);

    expect(output).toContain("dep_api_2");
    expect(output).toContain("dep_api_1");
    expect(output.indexOf("dep_api_2")).toBeLessThan(
      output.indexOf("dep_api_1"),
    );
  });

  it("reports no deployments cleanly", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue([]);

    const output = await deploymentsCommand(["api-example"], CTX);

    expect(output.toLowerCase()).toContain("no deployment");
  });

  it("propagates resolveService errors", async () => {
    resolveServiceMock.mockRejectedValue(new AxiError("nope", "NOT_FOUND", []));

    await expect(deploymentsCommand(["nope"], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
