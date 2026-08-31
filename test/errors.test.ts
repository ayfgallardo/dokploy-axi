import { describe, expect, it } from "vitest";
import {
  AxiError,
  dokployErrorMessage,
  mapDokployError,
  mapNetworkError,
} from "../src/errors.js";

const TRPC_ERROR = {
  error: {
    message: "Compose not found",
    code: -32004,
    data: { httpStatus: 404, code: "NOT_FOUND" },
  },
};

describe("dokployErrorMessage", () => {
  it("reads the tRPC envelope", () => {
    expect(dokployErrorMessage(TRPC_ERROR)).toBe("Compose not found");
  });

  it("reads the OpenAPI plain shape", () => {
    expect(
      dokployErrorMessage({ message: "Input validation failed", status: 400 }),
    ).toBe("Input validation failed");
  });

  it("reads a plain string body", () => {
    expect(dokployErrorMessage("Internal Server Error")).toBe(
      "Internal Server Error",
    );
  });

  it("reads an `error` string body", () => {
    expect(dokployErrorMessage({ error: "boom" })).toBe("boom");
  });

  it("returns undefined for an unrecognised body", () => {
    expect(dokployErrorMessage({ nothing: true })).toBeUndefined();
    expect(dokployErrorMessage(undefined)).toBeUndefined();
  });
});

describe("mapDokployError", () => {
  it("maps 401 to a guided AUTH_REQUIRED", () => {
    const error = mapDokployError(
      401,
      { message: "Unauthorized" },
      "compose.one",
    );

    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions.join(" ")).toContain("DOKPLOY_API_KEY");
  });

  it("blames IP filtering rather than the key on a 403", () => {
    const error = mapDokployError(403, "Forbidden", "project.all");

    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toContain("probable IP filtering");
    expect(error.suggestions.join(" ")).toMatch(/401/);
  });

  it("maps 404 to NOT_FOUND and keeps the server message", () => {
    const error = mapDokployError(404, { message: "Not found" }, "compose.one");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("Not found");
  });

  it("maps 400 to VALIDATION_ERROR", () => {
    expect(
      mapDokployError(400, { message: "bad" }, "compose.update").code,
    ).toBe("VALIDATION_ERROR");
  });

  it("maps 500 to API_ERROR and names the procedure", () => {
    const error = mapDokployError(500, undefined, "compose.deploy");

    expect(error.code).toBe("API_ERROR");
    expect(error.message).toContain("compose.deploy");
  });

  it("prefers the tRPC httpStatus over the transport status", () => {
    // tRPC can answer HTTP 200 while the envelope carries the real status.
    const error = mapDokployError(200, TRPC_ERROR, "compose.one");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Compose not found");
  });
});

describe("mapNetworkError", () => {
  it("reports the host as unreachable", () => {
    const error = mapNetworkError(
      new Error("fetch failed"),
      "https://dokploy.example.com",
    );

    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toContain("https://dokploy.example.com");
  });
});
