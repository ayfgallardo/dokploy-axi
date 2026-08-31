import { beforeEach, describe, expect, it, vi } from "vitest";

const dokployGetMock = vi.fn();
const dokployPostMock = vi.fn();

vi.mock("../../src/dokploy.js", () => ({
  dokployGet: dokployGetMock,
  dokployPost: dokployPostMock,
}));

const { apiCommand, isMutationProcedure } =
  await import("../../src/commands/api.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

beforeEach(() => {
  dokployGetMock.mockReset();
  dokployPostMock.mockReset();
});

describe("isMutationProcedure", () => {
  it("treats known read patterns as reads", () => {
    for (const procedure of [
      "project.all",
      "compose.one",
      "domain.byComposeId",
      "deployment.readLogs",
      "application.search",
      "server.getServerMetrics",
      "project.homeStats",
      "compose.loadServices",
    ]) {
      expect(isMutationProcedure(procedure)).toBe(false);
    }
  });

  it("treats known write patterns as mutations", () => {
    for (const procedure of [
      "compose.deploy",
      "compose.update",
      "compose.start",
      "compose.stop",
      "domain.create",
      "application.redeploy",
    ]) {
      expect(isMutationProcedure(procedure)).toBe(true);
    }
  });
});

describe("apiCommand", () => {
  it("requires a procedure", async () => {
    await expect(apiCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("GETs a read procedure and prints the raw JSON", async () => {
    dokployGetMock.mockResolvedValueOnce({ total: 2 });

    const output = await apiCommand(["project.all"], CTX);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "project.all", {});
    expect(dokployPostMock).not.toHaveBeenCalled();
    expect(output).toContain('"total": 2');
  });

  it("passes --input through as GET params for a read procedure", async () => {
    dokployGetMock.mockResolvedValueOnce({ ok: true });

    await apiCommand(["compose.one", "--input", '{"composeId":"cmp_1"}'], CTX);

    expect(dokployGetMock).toHaveBeenCalledWith(CTX, "compose.one", {
      composeId: "cmp_1",
    });
  });

  it("refuses a mutation without --allow-mutation, firing no request", async () => {
    await expect(apiCommand(["compose.deploy"], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(dokployGetMock).not.toHaveBeenCalled();
    expect(dokployPostMock).not.toHaveBeenCalled();
  });

  it("POSTs a mutation once --allow-mutation is given", async () => {
    dokployPostMock.mockResolvedValueOnce({ done: true });

    const output = await apiCommand(
      [
        "compose.update",
        "--input",
        '{"composeId":"cmp_1","gitlabBranch":"main"}',
        "--allow-mutation",
      ],
      CTX,
    );

    expect(dokployPostMock).toHaveBeenCalledWith(CTX, "compose.update", {
      composeId: "cmp_1",
      gitlabBranch: "main",
    });
    expect(dokployGetMock).not.toHaveBeenCalled();
    expect(output).toContain('"done": true');
  });

  it("rejects a non-object --input", async () => {
    await expect(
      apiCommand(["project.all", "--input", "[1,2,3]"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(dokployGetMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON in --input", async () => {
    await expect(
      apiCommand(["project.all", "--input", "{not json"], CTX),
    ).rejects.toBeInstanceOf(AxiError);
  });
});
