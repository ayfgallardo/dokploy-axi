import { beforeEach, describe, expect, it, vi } from "vitest";

const dokployGetMock = vi.fn();
const resolveServiceMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({ dokployGet: dokployGetMock }));
vi.mock("../../src/registry.js", () => ({
  resolveService: resolveServiceMock,
}));

const { envViewCommand } = await import("../../src/commands/env.js");
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

describe("envViewCommand", () => {
  it("requires a service name", async () => {
    await expect(envViewCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("reads compose.one for a compose service", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ env: "FOO=bar\nBAZ=qux" });

    const output = await envViewCommand(["api-example"], CTX);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "compose.one", {
      composeId: "cmp_api_1",
    });
    expect(output).toContain("FOO=bar");
    expect(output).toContain("BAZ=qux");
  });

  it("reads application.one for an application service", async () => {
    resolveServiceMock.mockResolvedValue(APPLICATION_REF);
    dokployGetMock.mockResolvedValue({ env: "PORT=3000" });

    const output = await envViewCommand(["front-example"], CTX);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "application.one", {
      applicationId: "app_front_1",
    });
    expect(output).toContain("PORT=3000");
  });

  it("marks the output read-only and points writes at the Dokploy UI", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ env: "FOO=bar" });

    const output = await envViewCommand(["api-example"], CTX);

    expect(output.toLowerCase()).toContain("read-only");
    expect(output.toLowerCase()).toContain("ui");
  });

  it("handles an empty environment", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ env: null });

    const output = await envViewCommand(["api-example"], CTX);

    expect(output).toContain("(empty)");
  });

  it("propagates resolveService errors", async () => {
    resolveServiceMock.mockRejectedValue(new AxiError("nope", "NOT_FOUND", []));

    await expect(envViewCommand(["nope"], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
