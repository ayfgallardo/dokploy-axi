import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const dokployGetMock = vi.fn();
const resolveServiceMock = vi.fn();
const listDeploymentsMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({ dokployGet: dokployGetMock }));
vi.mock("../../src/registry.js", () => ({
  resolveService: resolveServiceMock,
}));
vi.mock("../../src/commands/deployments.js", () => ({
  listDeployments: listDeploymentsMock,
}));

const { logsCommand } = await import("../../src/commands/logs.js");
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

beforeEach(() => {
  dokployGetMock.mockReset();
  resolveServiceMock.mockReset();
  listDeploymentsMock.mockReset();
  resolveServiceMock.mockResolvedValue(COMPOSE_REF);
  dokployGetMock.mockResolvedValue(fixture("deployment-readLogs.json"));
});

describe("logsCommand", () => {
  it("requires a service name", async () => {
    await expect(logsCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("labels the output as build/deployment logs, not app logs", async () => {
    listDeploymentsMock.mockResolvedValue(
      fixture("deployment-allByCompose.json"),
    );

    const output = await logsCommand(["api-example"], CTX);

    expect(output.toLowerCase()).toContain("build");
    expect(output.toLowerCase()).toContain("deployment");
  });

  it("defaults to the latest deployment when --deployment is omitted", async () => {
    listDeploymentsMock.mockResolvedValue(
      fixture("deployment-allByCompose.json"),
    );

    await logsCommand(["api-example"], CTX);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "deployment.readLogs", {
      deploymentId: "dep_api_2",
      tail: 100,
    });
  });

  it("uses --deployment when given, skipping the deployment list lookup", async () => {
    await logsCommand(["api-example", "--deployment", "dep_explicit"], CTX);

    expect(listDeploymentsMock).not.toHaveBeenCalled();
    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "deployment.readLogs", {
      deploymentId: "dep_explicit",
      tail: 100,
    });
  });

  it("passes --tail through, clamped to 10000", async () => {
    await logsCommand(
      ["api-example", "--deployment", "dep_x", "--tail", "50"],
      CTX,
    );
    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "deployment.readLogs", {
      deploymentId: "dep_x",
      tail: 50,
    });

    dokployGetMock.mockClear();
    await logsCommand(
      ["api-example", "--deployment", "dep_x", "--tail", "999999"],
      CTX,
    );
    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "deployment.readLogs", {
      deploymentId: "dep_x",
      tail: 10000,
    });
  });

  it("rejects a non-positive --tail", async () => {
    await expect(
      logsCommand(["api-example", "--deployment", "dep_x", "--tail", "0"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("errors clearly when there is no deployment to read logs from", async () => {
    listDeploymentsMock.mockResolvedValue([]);

    await expect(logsCommand(["api-example"], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("propagates resolveService errors", async () => {
    resolveServiceMock.mockRejectedValue(new AxiError("nope", "NOT_FOUND", []));

    await expect(logsCommand(["nope"], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
