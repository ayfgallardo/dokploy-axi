import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { flushGain, readGainLog, startGain } = await import("../src/gain.js");
const { dokployGet } = await import("../src/dokploy.js");

const CTX = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

const PAYLOAD = JSON.stringify({
  composeId: "abc-123",
  name: "api-dossiers",
  branch: "main",
});

const fetchMock = vi.fn();

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("gain accounting across the tRPC fallback", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-gain-retry-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
    vi.stubEnv("AXI_GAIN", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("counts only the response the fallback actually served on a 500 retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(500, JSON.stringify({ message: "Internal server error" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, JSON.stringify({ result: { data: PAYLOAD } })),
      );
    startGain();
    await dokployGet(CTX, "compose.one", { composeId: "abc-123" });
    await flushGain("service view");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, JSON.stringify({ result: { data: PAYLOAD } })),
    );
    startGain();
    await dokployGet(CTX, "compose.one", { composeId: "abc-123" });
    await flushGain("service view");

    const [afterRetry, straightThrough] = readGainLog();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(afterRetry.raw).toBe(straightThrough.raw);
  });

  it("still counts an error body that no retry follows", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, JSON.stringify({ message: "Not found" })),
    );
    startGain();
    await expect(
      dokployGet(CTX, "compose.one", { composeId: "abc-123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await flushGain("service view");

    expect(readGainLog()[0].raw).toBeGreaterThan(0);
  });
});
