import { beforeEach, describe, expect, it, vi } from "vitest";

const listServicesMock = vi.fn();
const fetchServiceDetailMock = vi.fn();
const listDeploymentsMock = vi.fn();

vi.mock("../../src/registry.js", () => ({
  listServices: listServicesMock,
}));
vi.mock("../../src/commands/service.js", () => ({
  fetchServiceDetail: fetchServiceDetailMock,
}));
vi.mock("../../src/commands/deployments.js", () => ({
  listDeployments: listDeploymentsMock,
}));

const { homeCommand } = await import("../../src/commands/home.js");

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

beforeEach(() => {
  listServicesMock.mockReset();
  fetchServiceDetailMock.mockReset();
  listDeploymentsMock.mockReset();
  listDeploymentsMock.mockResolvedValue([]);
});

describe("homeCommand", () => {
  it("flags any service pinned to a non-main branch at the very top", async () => {
    listServicesMock.mockResolvedValue([API_REF, PROXY_REF]);
    fetchServiceDetailMock.mockImplementation(async (_ctx, ref) =>
      ref.name === "proxy-example"
        ? { gitlabBranch: "feature/example-branch", autoDeploy: true }
        : { gitlabBranch: "main", autoDeploy: true },
    );

    const output = await homeCommand([], CTX);

    const pinnedIndex = output.indexOf("proxy-example");
    const servicesHeaderIndex = output.indexOf("services");
    expect(pinnedIndex).toBeGreaterThanOrEqual(0);
    expect(pinnedIndex).toBeLessThan(servicesHeaderIndex);
    expect(output).toContain("feature/example-branch");
  });

  it("shows status and last deployment for every service", async () => {
    listServicesMock.mockResolvedValue([API_REF]);
    fetchServiceDetailMock.mockResolvedValue({
      gitlabBranch: "main",
      autoDeploy: true,
    });
    listDeploymentsMock.mockResolvedValue([
      {
        deploymentId: "dep_1",
        status: "done",
        createdAt: "2026-08-27T12:00:00.000Z",
      },
    ]);

    const output = await homeCommand([], CTX);

    expect(output).toContain("api-example");
    expect(output).toContain("running");
    expect(output).toContain("dep_1");
  });

  it("says nothing extra when every service tracks main", async () => {
    listServicesMock.mockResolvedValue([API_REF]);
    fetchServiceDetailMock.mockResolvedValue({
      gitlabBranch: "main",
      autoDeploy: true,
    });

    const output = await homeCommand([], CTX);

    expect(output.toLowerCase()).not.toContain("pinned");
  });

  it("suggests logs for an errored service", async () => {
    const errored = { ...API_REF, status: "error" };
    listServicesMock.mockResolvedValue([errored]);
    fetchServiceDetailMock.mockResolvedValue({
      gitlabBranch: "main",
      autoDeploy: true,
    });

    const output = await homeCommand([], CTX);

    expect(output).toContain("dokploy-axi logs api-example");
  });
});
