import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DokployContext } from "../src/config.js";
import { dokployGet, dokployPost } from "../src/dokploy.js";
import { AxiError } from "../src/errors.js";

const CTX: DokployContext = {
  url: "https://dokploy.example.com",
  projectName: "example-project",
  apiKey: "fake-api-key",
};

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function call(index: number): [string, RequestInit] {
  return fetchMock.mock.calls[index] as [string, RequestInit];
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAPI facade", () => {
  it("GETs {url}/api/{procedure} with params in the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { composeId: "cmp_1" }));

    const result = await dokployGet<{ composeId: string }>(CTX, "compose.one", {
      composeId: "cmp_1",
    });

    expect(result).toEqual({ composeId: "cmp_1" });
    const [url, init] = call(0);
    expect(url).toBe(
      "https://dokploy.example.com/api/compose.one?composeId=cmp_1",
    );
    expect(init.method).toBe("GET");
  });

  it("sends the key as an x-api-key header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await dokployGet(CTX, "project.all");

    expect(headerOf(call(0)[1], "x-api-key")).toBe("fake-api-key");
  });

  it("omits the query string when there are no params", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await dokployGet(CTX, "project.all");

    expect(call(0)[0]).toBe("https://dokploy.example.com/api/project.all");
  });

  it("drops undefined and null params", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await dokployGet(CTX, "deployment.allByCompose", {
      composeId: "cmp_1",
      limit: undefined,
      cursor: null,
    });

    expect(call(0)[0]).toBe(
      "https://dokploy.example.com/api/deployment.allByCompose?composeId=cmp_1",
    );
  });

  it("POSTs the body as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await dokployPost(CTX, "compose.deploy", { composeId: "cmp_1" });

    const [url, init] = call(0);
    expect(url).toBe("https://dokploy.example.com/api/compose.deploy");
    expect(init.method).toBe("POST");
    expect(headerOf(init, "content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ composeId: "cmp_1" }));
  });

  it("returns undefined for an empty body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(dokployPost(CTX, "compose.stop", {})).resolves.toBeUndefined();
  });
});

describe("tRPC fallback on OpenAPI 500 (dokploy#3793)", () => {
  it("retries a GET through /api/trpc and unwraps result.data", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: "Internal error" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { result: { data: { composeId: "cmp_1" } } }),
      );

    const result = await dokployGet(CTX, "compose.one", { composeId: "cmp_1" });

    expect(result).toEqual({ composeId: "cmp_1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const input = encodeURIComponent(
      JSON.stringify({ json: { composeId: "cmp_1" } }),
    );
    expect(call(1)[0]).toBe(
      `https://dokploy.example.com/api/trpc/compose.one?input=${input}`,
    );
    expect(call(1)[1].method).toBe("GET");
    expect(headerOf(call(1)[1], "x-api-key")).toBe("fake-api-key");
  });

  it("unwraps the superjson `json` envelope when present", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { result: { data: { json: [{ name: "proxy" }] } } }),
      );

    await expect(dokployGet(CTX, "project.all")).resolves.toEqual([
      { name: "proxy" },
    ]);
  });

  it("retries a POST through /api/trpc with a {json: body} payload", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { result: { data: null } }));

    await dokployPost(CTX, "compose.update", {
      composeId: "cmp_1",
      gitlabBranch: "feature/example",
    });

    const [url, init] = call(1);
    expect(url).toBe("https://dokploy.example.com/api/trpc/compose.update");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        json: { composeId: "cmp_1", gitlabBranch: "feature/example" },
      }),
    );
  });

  it("surfaces the tRPC error when the fallback also fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: "Internal error" }))
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: {
            message: "Compose not found",
            code: -32004,
            data: { httpStatus: 404 },
          },
        }),
      );

    await expect(
      dokployGet(CTX, "compose.one", { composeId: "unknown" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Compose not found",
    });
  });

  it("does not fall back on a 403", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, "Forbidden"));

    const error = await dokployGet(CTX, "project.all").catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("FORBIDDEN");
    expect((error as AxiError).message).toContain("probable IP filtering");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on a 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));

    await expect(dokployGet(CTX, "project.all")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("network failures", () => {
  it("reports an unreachable server", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));

    await expect(dokployGet(CTX, "project.all")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
