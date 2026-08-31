import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const dokployGetMock = vi.fn();
const listServicesMock = vi.fn();
const resolveServiceMock = vi.fn();
const listDeploymentsMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({ dokployGet: dokployGetMock }));
vi.mock("../../src/registry.js", () => ({
  listServices: listServicesMock,
  resolveService: resolveServiceMock,
}));
vi.mock("../../src/commands/deployments.js", () => ({
  listDeployments: listDeploymentsMock,
}));

const { serviceListCommand, serviceViewCommand } =
  await import("../../src/commands/service.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

const API_REF = {
  kind: "compose" as const,
  id: "cmp_api_1",
  name: "api-example",
  status: "running",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

const WORKER_REF = {
  kind: "compose" as const,
  id: "cmp_worker_1",
  name: "worker-example",
  status: "error",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

const PROXY_REF = {
  kind: "compose" as const,
  id: "cmp_proxy_1",
  name: "proxy-example",
  status: "done",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

const FRONT_REF = {
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
  listServicesMock.mockReset();
  resolveServiceMock.mockReset();
  listDeploymentsMock.mockReset();
});

describe("serviceListCommand", () => {
  it("lists composes and applications with status, branch and autoDeploy", async () => {
    listServicesMock.mockResolvedValue([API_REF, FRONT_REF]);
    dokployGetMock.mockImplementation((_ctx: unknown, procedure: string) =>
      procedure === "compose.one"
        ? fixture("compose-one.json")
        : fixture("application-one.json"),
    );

    const output = await serviceListCommand([], CTX);

    expect(output).toContain("api-example");
    expect(output).toContain("front-example");
    expect(output).toContain("main");
    expect(output.toLowerCase()).toContain("running");
  });

  it("suggests unpin for a pinned branch and logs for an error status", async () => {
    listServicesMock.mockResolvedValue([WORKER_REF, PROXY_REF]);
    dokployGetMock.mockImplementation(
      (_ctx: unknown, _p: string, params: Record<string, string>) =>
        params.composeId === "cmp_worker_1"
          ? fixture("compose-one-error.json")
          : fixture("compose-one-pinned.json"),
    );

    const output = await serviceListCommand([], CTX);

    expect(output).toContain("dokploy-axi service unpin proxy-example");
    expect(output).toContain("dokploy-axi logs worker-example");
  });
});

describe("serviceViewCommand", () => {
  it("requires a service name", async () => {
    await expect(serviceViewCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("shows status, gitlabBranch, watchPaths, domain and docker services for a compose", async () => {
    resolveServiceMock.mockResolvedValue(API_REF);
    dokployGetMock.mockImplementation((_ctx: unknown, procedure: string) => {
      if (procedure === "compose.one") return fixture("compose-one.json");
      if (procedure === "domain.byComposeId")
        return fixture("domain-byComposeId.json");
      if (procedure === "compose.loadServices")
        return fixture("compose-loadServices.json");
      throw new Error(`unexpected procedure ${procedure}`);
    });
    listDeploymentsMock.mockResolvedValue(
      fixture("deployment-allByCompose.json"),
    );

    const output = await serviceViewCommand(["api-example"], CTX);

    expect(output).toContain("main");
    expect(output).toContain("services/api-example/**");
    expect(output).toContain("api-example.dev.dokploy.example.com");
    expect(output).toContain("web");
    expect(output).toContain("worker");
    expect(output).toContain("dep_api_2");
  });

  it("flags a pinned branch with an unpin suggestion", async () => {
    resolveServiceMock.mockResolvedValue(PROXY_REF);
    dokployGetMock.mockImplementation((_ctx: unknown, procedure: string) => {
      if (procedure === "compose.one")
        return fixture("compose-one-pinned.json");
      if (procedure === "domain.byComposeId") return [];
      if (procedure === "compose.loadServices") return [];
      throw new Error(`unexpected procedure ${procedure}`);
    });
    listDeploymentsMock.mockResolvedValue([]);

    const output = await serviceViewCommand(["proxy-example"], CTX);

    expect(output).toContain("feature/example-branch");
    expect(output).toContain("dokploy-axi service unpin proxy-example");
  });

  it("skips domain and docker-services lookups for an application", async () => {
    resolveServiceMock.mockResolvedValue(FRONT_REF);
    dokployGetMock.mockImplementation((_ctx: unknown, procedure: string) => {
      if (procedure === "application.one")
        return fixture("application-one.json");
      throw new Error(`unexpected procedure ${procedure}`);
    });
    listDeploymentsMock.mockResolvedValue([]);

    const output = await serviceViewCommand(["front-example"], CTX);

    expect(output).toContain("front-example");
    expect(dokployGetMock).not.toHaveBeenCalledWith(
      CTX,
      "domain.byComposeId",
      expect.anything(),
    );
  });

  it("propagates resolveService errors", async () => {
    resolveServiceMock.mockRejectedValue(new AxiError("nope", "NOT_FOUND", []));

    await expect(serviceViewCommand(["nope"], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
