import type { DokployContext } from "./config.js";
import { mapDokployError, mapNetworkError } from "./errors.js";
import { dropRetriedRawBody, recordRawBody } from "./gain.js";

export type DokployParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export type DokployBody = Record<string, unknown>;

interface Attempt {
  url: string;
  init: RequestInit;
}

function headers(ctx: DokployContext, json: boolean): Record<string, string> {
  return {
    "x-api-key": ctx.apiKey,
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function queryString(params: DokployParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.set(key, String(value));
  }
  return search.toString();
}

function openApiGet(
  ctx: DokployContext,
  procedure: string,
  params: DokployParams,
): Attempt {
  const query = queryString(params);
  return {
    url: `${ctx.url}/api/${procedure}${query ? `?${query}` : ""}`,
    init: { method: "GET", headers: headers(ctx, false) },
  };
}

function openApiPost(
  ctx: DokployContext,
  procedure: string,
  body: DokployBody,
): Attempt {
  return {
    url: `${ctx.url}/api/${procedure}`,
    init: {
      method: "POST",
      headers: headers(ctx, true),
      body: JSON.stringify(body),
    },
  };
}

function trpcGet(
  ctx: DokployContext,
  procedure: string,
  params: DokployParams,
): Attempt {
  const input = encodeURIComponent(JSON.stringify({ json: params }));
  return {
    url: `${ctx.url}/api/trpc/${procedure}?input=${input}`,
    init: { method: "GET", headers: headers(ctx, false) },
  };
}

function trpcPost(
  ctx: DokployContext,
  procedure: string,
  body: DokployBody,
): Attempt {
  return {
    url: `${ctx.url}/api/trpc/${procedure}`,
    init: {
      method: "POST",
      headers: headers(ctx, true),
      body: JSON.stringify({ json: body }),
    },
  };
}

async function send(
  ctx: DokployContext,
  attempt: Attempt,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(attempt.url, attempt.init);
  } catch (error) {
    throw mapNetworkError(error, ctx.url);
  }

  const text = await response.text();
  recordRawBody(text);
  let body: unknown;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

/** tRPC wraps its payload in `result.data`, itself superjson-wrapped in `json`. */
function unwrapTrpc(body: unknown): unknown {
  const result = (body as { result?: { data?: unknown } } | undefined)?.result;
  if (result === undefined) {
    return body;
  }
  const data = result.data;
  if (typeof data === "object" && data !== null && "json" in data) {
    return (data as { json: unknown }).json;
  }
  return data;
}

/**
 * dokploy#3793: the OpenAPI facade answers 500 on payloads the tRPC engine
 * serves fine, so a 500 is retried there before it is called an error.
 */
async function request<T>(
  ctx: DokployContext,
  procedure: string,
  openApi: Attempt,
  trpc: Attempt,
): Promise<T> {
  const first = await send(ctx, openApi);
  if (first.status < 400) {
    return first.body as T;
  }
  if (first.status !== 500) {
    throw mapDokployError(first.status, first.body, procedure);
  }

  // The rejected 500 body is an internal round-trip the agent never reads.
  dropRetriedRawBody();
  const fallback = await send(ctx, trpc);
  if (fallback.status >= 400) {
    throw mapDokployError(fallback.status, fallback.body, procedure);
  }
  return unwrapTrpc(fallback.body) as T;
}

export function dokployGet<T>(
  ctx: DokployContext,
  procedure: string,
  params: DokployParams = {},
): Promise<T> {
  return request<T>(
    ctx,
    procedure,
    openApiGet(ctx, procedure, params),
    trpcGet(ctx, procedure, params),
  );
}

export function dokployPost<T>(
  ctx: DokployContext,
  procedure: string,
  body: DokployBody = {},
): Promise<T> {
  return request<T>(
    ctx,
    procedure,
    openApiPost(ctx, procedure, body),
    trpcPost(ctx, procedure, body),
  );
}
