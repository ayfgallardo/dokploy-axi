import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "CONFIG_MISSING"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

export const AUTH_HELP = [
  "Export the key: export DOKPLOY_API_KEY=<key>",
  "Generate one in Dokploy > Settings > API/CLI",
];

const FORBIDDEN_HELP = [
  "A wrong key answers 401, not 403 — check the Traefik IP allowlist of the server",
  "Retry from an allowed network (VPN) before regenerating the key",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The `error` object of a tRPC envelope: `{error:{message, code, data:{httpStatus}}}`. */
function trpcError(body: unknown): Record<string, unknown> | undefined {
  const error = asRecord(asRecord(body)?.["error"]);
  return typeof error?.["message"] === "string" ? error : undefined;
}

/** tRPC and the OpenAPI facade carry their message in different places. */
export function dokployErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body.trim() === "" ? undefined : body;
  }

  const trpc = trpcError(body);
  if (trpc) {
    return trpc["message"] as string;
  }

  const record = asRecord(body);
  for (const key of ["message", "error"]) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

const statusMap: Record<number, { code: ErrorCode; suggestions: string[] }> = {
  400: { code: "VALIDATION_ERROR", suggestions: [] },
  401: { code: "AUTH_REQUIRED", suggestions: AUTH_HELP },
  403: { code: "FORBIDDEN", suggestions: FORBIDDEN_HELP },
  404: { code: "NOT_FOUND", suggestions: [] },
  422: { code: "VALIDATION_ERROR", suggestions: [] },
  500: { code: "API_ERROR", suggestions: [] },
};

export function mapDokployError(
  status: number,
  body: unknown,
  procedure: string,
): AxiError {
  // A tRPC envelope can travel over a 200: its httpStatus is the real one.
  const envelopeStatus = asRecord(trpcError(body)?.["data"])?.["httpStatus"];
  const effective =
    typeof envelopeStatus === "number" ? envelopeStatus : status;

  const mapped = statusMap[effective] ?? { code: "UNKNOWN", suggestions: [] };
  const message =
    dokployErrorMessage(body) ??
    `Dokploy answered ${effective} on ${procedure}`;

  if (mapped.code === "FORBIDDEN") {
    return new AxiError(
      `Dokploy answered 403 on ${procedure} — probable IP filtering, not a bad key`,
      "FORBIDDEN",
      FORBIDDEN_HELP,
    );
  }

  return new AxiError(message, mapped.code, mapped.suggestions);
}

export function mapNetworkError(error: unknown, url: string): AxiError {
  const detail = error instanceof Error ? error.message : String(error);
  return new AxiError(`${url} unreachable: ${detail}`, "NETWORK_ERROR", [
    "Check DOKPLOY_URL or the `url` field of the config file",
  ]);
}
