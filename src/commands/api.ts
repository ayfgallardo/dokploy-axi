import { takeFlag } from "../args.js";
import type { DokployContext } from "../config.js";
import { dokployGet, dokployPost, type DokployParams } from "../dokploy.js";
import { AxiError } from "../errors.js";

/** Take a value-less flag out of `args`, mutating it in place. */
function takeBooleanFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

/**
 * Dokploy's tRPC procedures carry no explicit read/write marker, so mutation
 * detection goes by name: a curated list of read-verb prefixes seen across
 * the whole API surface (all, one, byX, search, get..., readLogs, ...).
 * Anything unmatched — including a few genuine reads like
 * `domain.validateDomain` or `server.security` — is conservatively treated
 * as a mutation: refusing a safe read costs a retyped flag, letting a write
 * through by mistake does not.
 */
const READ_PREFIXES = [
  "all",
  "one",
  "by",
  "search",
  "list",
  "get",
  "read",
  "load",
  "fetch",
  "count",
  "public",
  "home",
  "canGenerate",
  "template",
  "preview",
];

export function isMutationProcedure(procedure: string): boolean {
  const name = procedure.split(".").pop() ?? "";
  return !READ_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function parseInput(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AxiError("--input must be a JSON object", "VALIDATION_ERROR", [
      `Run \`dokploy-axi api <procedure> --input '{"key":"value"}'\``,
    ]);
  }

  return parsed as Record<string, unknown>;
}

/** Raw passthrough to the Dokploy tRPC engine — same auth and fallback as every other command. */
export async function apiCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const rest = [...args];
  const allowMutation = takeBooleanFlag(rest, "--allow-mutation");
  const inputFlag = takeFlag(rest, "--input");
  const procedure = rest[0];

  if (!procedure) {
    throw new AxiError("api requires a <procedure>", "VALIDATION_ERROR", [
      "Run `dokploy-axi api <router.procedure> [--input <json>]`",
    ]);
  }

  const mutation = isMutationProcedure(procedure);
  if (mutation && !allowMutation) {
    throw new AxiError(
      `\`${procedure}\` looks like a mutation — refused without --allow-mutation`,
      "VALIDATION_ERROR",
      ["Add --allow-mutation to confirm a write"],
    );
  }

  const params = parseInput(inputFlag);
  const result = mutation
    ? await dokployPost(ctx, procedure, params)
    : await dokployGet(ctx, procedure, params as DokployParams);

  return `${JSON.stringify(result ?? null, null, 2)}\n`;
}
