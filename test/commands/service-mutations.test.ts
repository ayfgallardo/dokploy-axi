import { beforeEach, describe, expect, it, vi } from "vitest";

const dokployGetMock = vi.fn();
const dokployPostMock = vi.fn();
const resolveServiceMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({
  dokployGet: dokployGetMock,
  dokployPost: dokployPostMock,
}));
vi.mock("../../src/registry.js", () => ({
  resolveService: resolveServiceMock,
}));

const {
  serviceDeployCommand,
  serviceRedeployCommand,
  serviceStartCommand,
  serviceStopCommand,
  servicePinCommand,
  serviceUnpinCommand,
  watchStatus,
} = await import("../../src/commands/service.js");

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

const APP_REF = {
  kind: "application" as const,
  id: "app_front_1",
  name: "front-example",
  status: "running",
  projectId: "prj_1",
  projectName: "example-project",
  environmentId: "env_dev",
  environmentName: "dev",
};

const instantSleep = async () => {};

beforeEach(() => {
  dokployGetMock.mockReset();
  dokployPostMock.mockReset();
  resolveServiceMock.mockReset();
});

describe("watchStatus", () => {
  it("stabilizes only on two consecutive spaced reads agreeing (trap 1: transient `done`)", async () => {
    dokployGetMock
      .mockResolvedValueOnce({ composeStatus: "running" })
      .mockResolvedValueOnce({ composeStatus: "done" })
      .mockResolvedValueOnce({ composeStatus: "running" })
      .mockResolvedValueOnce({ composeStatus: "running" });

    const result = await watchStatus(CTX, COMPOSE_REF, {
      sleep: instantSleep,
      intervalMs: 10,
      timeoutMs: 10_000,
    });

    expect(result).toBe("running");
    expect(dokployGetMock).toHaveBeenCalledTimes(4);
  });

  it("throws an explicit timeout naming elapsed time and telling to check the VPS", async () => {
    dokployGetMock.mockResolvedValue({ composeStatus: "running" });

    await expect(
      watchStatus(CTX, COMPOSE_REF, {
        sleep: instantSleep,
        intervalMs: 1000,
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "API_ERROR",
      message: expect.stringContaining("still running after 0s"),
    });
    await expect(
      watchStatus(CTX, COMPOSE_REF, {
        sleep: instantSleep,
        intervalMs: 1000,
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("check the VPS"),
    });
  });
});

describe("serviceDeployCommand", () => {
  it("fires compose.deploy and reports without polling when --watch is absent", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);

    const output = await serviceDeployCommand(["api-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.deploy", {
      composeId: "cmp_api_1",
    });
    expect(dokployGetMock).not.toHaveBeenCalled();
    expect(output).toContain("triggered");
  });

  it("uses application.redeploy for an application (no application.deploy endpoint)", async () => {
    resolveServiceMock.mockResolvedValue(APP_REF);

    await serviceDeployCommand(["front-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "application.redeploy", {
      applicationId: "app_front_1",
    });
  });

  it("polls with stabilization and reports the settled status with --watch", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock
      .mockResolvedValueOnce({ composeStatus: "done" })
      .mockResolvedValueOnce({ composeStatus: "running" })
      .mockResolvedValueOnce({ composeStatus: "running" });

    const output = await serviceDeployCommand(["api-example", "--watch"], CTX, {
      sleep: instantSleep,
      intervalMs: 10,
      timeoutMs: 10_000,
    });

    expect(output).toContain("running");
  });

  it("propagates the watch timeout as an error", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock
      .mockResolvedValueOnce({ composeStatus: "running" })
      .mockResolvedValueOnce({ composeStatus: "done" });

    await expect(
      serviceDeployCommand(["api-example", "--watch", "--timeout", "1"], CTX, {
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });
});

describe("serviceRedeployCommand", () => {
  it("fires compose.redeploy", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);

    await serviceRedeployCommand(["api-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.redeploy", {
      composeId: "cmp_api_1",
    });
  });
});

describe("serviceStartCommand / serviceStopCommand", () => {
  it("fires compose.start", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);

    const output = await serviceStartCommand(["api-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.start", {
      composeId: "cmp_api_1",
    });
    expect(output).toContain("triggered");
  });

  it("fires compose.stop", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);

    await serviceStopCommand(["api-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.stop", {
      composeId: "cmp_api_1",
    });
  });

  it("rejects start/stop for an application (no such endpoint)", async () => {
    resolveServiceMock.mockResolvedValue(APP_REF);

    await expect(
      serviceStartCommand(["front-example"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      serviceStopCommand(["front-example"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(dokployPostMock).not.toHaveBeenCalled();
  });
});

describe("servicePinCommand", () => {
  it("sends gitlabBranch as the only mutated field, never appName (trap 3)", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ gitlabBranch: "main" });

    const output = await servicePinCommand(
      ["api-example", "feature/example-branch"],
      CTX,
    );

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.update", {
      composeId: "cmp_api_1",
      gitlabBranch: "feature/example-branch",
    });
    const [, , body] = dokployPostMock.mock.calls[0];
    expect(body).not.toHaveProperty("appName");
    expect(output).toContain("feature/example-branch");
  });

  it("suggests the corresponding unpin after a pin (trap 7)", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ gitlabBranch: "main" });

    const output = await servicePinCommand(
      ["api-example", "feature/example-branch"],
      CTX,
    );

    expect(output).toContain("dokploy-axi service unpin api-example");
  });

  it("is idempotent: pinning to the already-tracked branch succeeds without mutating", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({
      gitlabBranch: "feature/example-branch",
    });

    const output = await servicePinCommand(
      ["api-example", "feature/example-branch"],
      CTX,
    );

    expect(dokployPostMock).not.toHaveBeenCalled();
    expect(output).toContain("feature/example-branch");
  });

  it("rejects pinning an application (no branch pinning endpoint)", async () => {
    resolveServiceMock.mockResolvedValue(APP_REF);

    await expect(
      servicePinCommand(["front-example", "feature/x"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(dokployPostMock).not.toHaveBeenCalled();
  });

  it("requires a branch argument", async () => {
    await expect(servicePinCommand(["api-example"], CTX)).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });
});

describe("serviceUnpinCommand", () => {
  it("pins back to main, sending gitlabBranch as the only field", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({
      gitlabBranch: "feature/example-branch",
    });

    const output = await serviceUnpinCommand(["api-example"], CTX);

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.update", {
      composeId: "cmp_api_1",
      gitlabBranch: "main",
    });
    expect(output).toContain("main");
  });

  it("does not suggest a further unpin once back on main", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({
      gitlabBranch: "feature/example-branch",
    });

    const output = await serviceUnpinCommand(["api-example"], CTX);

    expect(output).not.toContain("service unpin");
  });

  it("is idempotent when already on main", async () => {
    resolveServiceMock.mockResolvedValue(COMPOSE_REF);
    dokployGetMock.mockResolvedValue({ gitlabBranch: "main" });

    await serviceUnpinCommand(["api-example"], CTX);

    expect(dokployPostMock).not.toHaveBeenCalled();
  });
});
