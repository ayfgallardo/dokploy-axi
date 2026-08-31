import { takeBooleanFlag, takeFlag } from "../args.js";
import type { DokployContext } from "../config.js";
import { dokployGet, dokployPost } from "../dokploy.js";
import { AxiError } from "../errors.js";
import { listServices, resolveService, type ServiceRef } from "../registry.js";
import { getSuggestions } from "../suggestions.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";
import { listDeployments } from "./deployments.js";

export interface ServiceDetail {
  gitlabBranch?: string | null;
  watchPaths?: string[];
  autoDeploy?: boolean;
}

function detailProcedure(kind: ServiceRef["kind"]): string {
  return kind === "compose" ? "compose.one" : "application.one";
}

function detailParams(ref: ServiceRef): Record<string, string> {
  return ref.kind === "compose"
    ? { composeId: ref.id }
    : { applicationId: ref.id };
}

/** Compose and application detail live on different procedures but share these fields. */
export function fetchServiceDetail(
  ctx: DokployContext,
  ref: ServiceRef,
): Promise<ServiceDetail> {
  return dokployGet<ServiceDetail>(
    ctx,
    detailProcedure(ref.kind),
    detailParams(ref),
  );
}

export async function serviceListCommand(
  _args: string[],
  ctx: DokployContext,
): Promise<string> {
  const services = await listServices(ctx);
  const rows = await Promise.all(
    services.map(async (ref) => {
      const detail = await fetchServiceDetail(ctx, ref);
      return {
        name: ref.name,
        kind: ref.kind,
        status: ref.status,
        gitlabBranch: detail.gitlabBranch ?? "main",
        autoDeploy: detail.autoDeploy ?? false,
      };
    }),
  );

  const suggestions = rows.flatMap((row) =>
    getSuggestions({
      name: row.name,
      status: row.status,
      gitlabBranch: row.gitlabBranch,
    }),
  );

  return renderOutput([
    renderList("services", rows, [
      field("name"),
      field("kind"),
      field("status"),
      field("gitlabBranch", "branch"),
      field("autoDeploy"),
    ]),
    renderHelp(suggestions),
  ]);
}

export async function serviceViewCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const name = args[0];
  if (!name) {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi service view <NAME>`",
    ]);
  }

  const ref = await resolveService(ctx, name);

  const isCompose = ref.kind === "compose";
  const [detail, domains, dockerServices, deployments] = await Promise.all([
    fetchServiceDetail(ctx, ref),
    isCompose
      ? dokployGet<{ host: string }[]>(ctx, "domain.byComposeId", {
          composeId: ref.id,
        })
      : Promise.resolve([]),
    isCompose
      ? dokployGet<string[]>(ctx, "compose.loadServices", {
          composeId: ref.id,
        })
      : Promise.resolve([]),
    listDeployments(ctx, ref),
  ]);

  const branch = detail.gitlabBranch ?? "main";
  const lastDeployment = deployments[0];

  return renderOutput([
    renderDetail(
      "service",
      {
        name: ref.name,
        kind: ref.kind,
        status: ref.status,
        gitlabBranch: branch,
        watchPaths: (detail.watchPaths ?? []).join(",") || "none",
        autoDeploy: detail.autoDeploy ?? false,
        domains: domains.map((d) => d.host).join(",") || "none",
        dockerServices: dockerServices.join(",") || "none",
        lastDeploymentId: lastDeployment?.deploymentId ?? "none",
        lastDeploymentStatus: lastDeployment?.status ?? "none",
      },
      [
        field("name"),
        field("kind"),
        field("status"),
        field("gitlabBranch", "branch"),
        field("watchPaths"),
        field("autoDeploy"),
        field("domains"),
        field("dockerServices"),
        field("lastDeploymentId"),
        field("lastDeploymentStatus"),
      ],
    ),
    renderHelp(
      getSuggestions({
        name: ref.name,
        status: ref.status,
        gitlabBranch: branch,
      }),
    ),
  ]);
}

function requireName(args: string[], usage: string): string {
  const name = args[0];
  if (!name) {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      `Run \`${usage}\``,
    ]);
  }
  return name;
}

function requireCompose(ref: ServiceRef, action: string): void {
  if (ref.kind !== "compose") {
    throw new AxiError(
      `\`${action}\` is only available for compose services — Dokploy exposes no equivalent for applications`,
      "VALIDATION_ERROR",
      [],
    );
  }
}

interface StatusPayload {
  composeStatus?: string;
  applicationStatus?: string;
}

async function fetchStatus(
  ctx: DokployContext,
  ref: ServiceRef,
): Promise<string> {
  const payload = await dokployGet<StatusPayload>(
    ctx,
    detailProcedure(ref.kind),
    detailParams(ref),
  );
  const status =
    ref.kind === "compose" ? payload.composeStatus : payload.applicationStatus;
  return status ?? "unknown";
}

export interface WatchOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

const TERMINAL_STATUSES = new Set(["done", "error", "idle"]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Traps 1+2: composeStatus flickers through `done` for a few seconds around a
 * deploy, and a zombie build stays `running` forever. So a status is trusted
 * only once two spaced reads agree, `running` is never terminal, and a
 * `done`/`idle` only counts once the watch has actually seen the build run —
 * otherwise the stale pre-build `done` would read as instant success.
 */
export async function watchStatus(
  ctx: DokployContext,
  ref: ServiceRef,
  options: WatchOptions = {},
): Promise<string> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const startedAt = now();
  let previous: string | undefined;
  let sawRunning = false;

  for (;;) {
    const current = await fetchStatus(ctx, ref);
    sawRunning ||= current === "running";

    const confirmed = current === previous;
    if (
      confirmed &&
      TERMINAL_STATUSES.has(current) &&
      (current === "error" || sawRunning)
    ) {
      return current;
    }
    previous = current;

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new AxiError(
        `\`${ref.name}\` still running after ${Math.round(elapsedMs / 1000)}s — check the VPS`,
        "API_ERROR",
        [
          `Run \`dokploy-axi deployments ${ref.name}\` or \`dokploy-axi logs ${ref.name}\` to investigate`,
        ],
      );
    }

    await sleep(intervalMs);
  }
}

function parseTimeoutSeconds(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AxiError(
      "--timeout must be a positive number of seconds",
      "VALIDATION_ERROR",
      [],
    );
  }
  return parsed;
}

/** Applications expose only `application.redeploy` — there is no `application.deploy`. */
function deployProcedure(
  kind: ServiceRef["kind"],
  action: "deploy" | "redeploy",
): string {
  return kind === "compose" ? `compose.${action}` : "application.redeploy";
}

async function runDeployLike(
  args: string[],
  ctx: DokployContext,
  action: "deploy" | "redeploy",
  watchOverrides: WatchOptions,
): Promise<string> {
  const rest = [...args];
  const watch = takeBooleanFlag(rest, "--watch");
  const timeoutFlag = takeFlag(rest, "--timeout");
  const name = requireName(
    rest,
    `dokploy-axi service ${action} <NAME> [--watch] [--timeout <SECONDS>]`,
  );

  const ref = await resolveService(ctx, name);
  await dokployPost(ctx, deployProcedure(ref.kind, action), detailParams(ref));

  if (!watch) {
    return renderOutput([
      `${action}[${ref.name}]: triggered`,
      renderHelp(getSuggestions({ name: ref.name, status: ref.status })),
    ]);
  }

  const timeoutMs =
    timeoutFlag !== undefined
      ? parseTimeoutSeconds(timeoutFlag) * 1000
      : undefined;
  const finalStatus = await watchStatus(ctx, ref, {
    ...watchOverrides,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  return renderOutput([
    `${action}[${ref.name}]: ${finalStatus}`,
    renderHelp(getSuggestions({ name: ref.name, status: finalStatus })),
  ]);
}

export function serviceDeployCommand(
  args: string[],
  ctx: DokployContext,
  watchOverrides: WatchOptions = {},
): Promise<string> {
  return runDeployLike(args, ctx, "deploy", watchOverrides);
}

export function serviceRedeployCommand(
  args: string[],
  ctx: DokployContext,
  watchOverrides: WatchOptions = {},
): Promise<string> {
  return runDeployLike(args, ctx, "redeploy", watchOverrides);
}

async function runStartStop(
  args: string[],
  ctx: DokployContext,
  action: "start" | "stop",
): Promise<string> {
  const name = requireName(args, `dokploy-axi service ${action} <NAME>`);
  const ref = await resolveService(ctx, name);
  requireCompose(ref, action);

  await dokployPost(ctx, `compose.${action}`, detailParams(ref));

  return renderOutput([
    `${action}[${ref.name}]: triggered`,
    renderHelp(getSuggestions({ name: ref.name, status: ref.status })),
  ]);
}

export function serviceStartCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  return runStartStop(args, ctx, "start");
}

export function serviceStopCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  return runStartStop(args, ctx, "stop");
}

/**
 * Trap 3: `compose.update` silently ignores `appName` — so `gitlabBranch` is
 * sent as the ONLY mutated field, alongside the required `composeId`.
 * Idempotent: a branch already tracked is reported as success with no call.
 */
async function pinTo(
  ctx: DokployContext,
  name: string,
  branch: string,
): Promise<string> {
  const ref = await resolveService(ctx, name);
  requireCompose(ref, "pin");

  const detail = await fetchServiceDetail(ctx, ref);
  const current = detail.gitlabBranch ?? "main";

  if (current !== branch) {
    await dokployPost(ctx, "compose.update", {
      composeId: ref.id,
      gitlabBranch: branch,
    });
  }

  const verb = current === branch ? "already tracking" : "now tracking";
  return renderOutput([
    `pin[${ref.name}]: ${verb} \`${branch}\``,
    renderHelp(
      getSuggestions({
        name: ref.name,
        status: ref.status,
        gitlabBranch: branch,
      }),
    ),
  ]);
}

export async function servicePinCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const name = requireName(args, "dokploy-axi service pin <NAME> <BRANCH>");
  const branch = args[1];
  if (!branch) {
    throw new AxiError("A branch is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi service pin <NAME> <BRANCH>`",
    ]);
  }
  return pinTo(ctx, name, branch);
}

/** Trap 7: `unpin` is `pin` back to `main`. */
export async function serviceUnpinCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const name = requireName(args, "dokploy-axi service unpin <NAME>");
  return pinTo(ctx, name, "main");
}
