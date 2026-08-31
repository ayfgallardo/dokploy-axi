import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DokployContext } from "../src/config.js";

const dokployGet = vi.fn();

vi.mock("../src/dokploy.js", () => ({
  dokployGet: (...args: unknown[]) => dokployGet(...args),
  dokployPost: vi.fn(),
}));

const { clearRegistryCache, listServices, resolveService } =
  await import("../src/registry.js");
const { AxiError } = await import("../src/errors.js");

const CTX: DokployContext = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

const PROJECTS = [
  {
    projectId: "prj_1",
    name: "example-project",
    environments: [
      {
        environmentId: "env_dev",
        name: "dev",
        applications: [
          {
            applicationId: "app_1",
            name: "front-example",
            // The random suffix the CLI must never expose nor send back.
            appName: "front-example-a1b2c3",
            applicationStatus: "done",
          },
        ],
        compose: [
          {
            composeId: "cmp_1",
            name: "api-example",
            appName: "api-example-d4e5f6",
            composeStatus: "running",
          },
          { composeId: "cmp_2", name: "proxy", composeStatus: "done" },
        ],
      },
      {
        environmentId: "env_prod",
        name: "production",
        applications: [],
        compose: [{ composeId: "cmp_3", name: "proxy", composeStatus: "idle" }],
      },
    ],
  },
  { projectId: "prj_2", name: "other-project", environments: [] },
];

function thrown(promise: Promise<unknown>): Promise<AxiError> {
  return promise.then(
    () => {
      throw new Error("expected the call to reject");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AxiError);
      return error as AxiError;
    },
  );
}

beforeEach(() => {
  clearRegistryCache();
  dokployGet.mockReset();
  dokployGet.mockResolvedValue(PROJECTS);
});

describe("listServices", () => {
  it("walks project → environment → composes + applications", async () => {
    const services = await listServices(CTX);

    expect(dokployGet).toHaveBeenCalledWith(CTX, "project.all");
    expect(services).toEqual([
      {
        kind: "compose",
        id: "cmp_1",
        name: "api-example",
        status: "running",
        projectId: "prj_1",
        projectName: "example-project",
        environmentId: "env_dev",
        environmentName: "dev",
      },
      {
        kind: "compose",
        id: "cmp_2",
        name: "proxy",
        status: "done",
        projectId: "prj_1",
        projectName: "example-project",
        environmentId: "env_dev",
        environmentName: "dev",
      },
      {
        kind: "application",
        id: "app_1",
        name: "front-example",
        status: "done",
        projectId: "prj_1",
        projectName: "example-project",
        environmentId: "env_dev",
        environmentName: "dev",
      },
      {
        kind: "compose",
        id: "cmp_3",
        name: "proxy",
        status: "idle",
        projectId: "prj_1",
        projectName: "example-project",
        environmentId: "env_prod",
        environmentName: "production",
      },
    ]);
  });

  it("never carries appName through", async () => {
    expect(JSON.stringify(await listServices(CTX))).not.toContain("appName");
    expect(JSON.stringify(await listServices(CTX))).not.toContain("a1b2c3");
  });

  it("caches project.all for the whole invocation", async () => {
    await listServices(CTX);
    await resolveService(CTX, "api-example");
    await resolveService(CTX, "front-example");

    expect(dokployGet).toHaveBeenCalledTimes(1);
  });

  it("reports the configured project as NOT_FOUND when absent", async () => {
    dokployGet.mockResolvedValue([
      { projectId: "prj_2", name: "other-project", environments: [] },
    ]);

    const error = await thrown(listServices(CTX));

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("example-project");
    expect(`${error.message} ${error.suggestions.join(" ")}`).toContain(
      "other-project",
    );
  });
});

describe("resolveService", () => {
  it("resolves a compose by its name", async () => {
    await expect(resolveService(CTX, "api-example")).resolves.toMatchObject({
      kind: "compose",
      id: "cmp_1",
      name: "api-example",
      environmentName: "dev",
    });
  });

  it("resolves an application by its name", async () => {
    await expect(resolveService(CTX, "front-example")).resolves.toMatchObject({
      kind: "application",
      id: "app_1",
      name: "front-example",
    });
  });

  it("rejects an ambiguous name with the candidates", async () => {
    const error = await thrown(resolveService(CTX, "proxy"));

    expect(error.code).toBe("VALIDATION_ERROR");
    const text = `${error.message} ${error.suggestions.join(" ")}`;
    expect(text).toContain("dev");
    expect(text).toContain("production");
  });

  it("rejects an unknown name with the available ones", async () => {
    const error = await thrown(resolveService(CTX, "api-exemple"));

    expect(error.code).toBe("NOT_FOUND");
    const text = `${error.message} ${error.suggestions.join(" ")}`;
    expect(text).toContain("api-exemple");
    expect(text).toContain("api-example");
    expect(text).toContain("front-example");
  });

  it("rejects an empty name", async () => {
    expect((await thrown(resolveService(CTX, ""))).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});
