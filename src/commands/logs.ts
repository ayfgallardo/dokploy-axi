import { takeFlag } from "../args.js";
import type { DokployContext } from "../config.js";
import { dokployGet } from "../dokploy.js";
import { AxiError } from "../errors.js";
import { resolveService } from "../registry.js";
import { listDeployments } from "./deployments.js";

const DEFAULT_TAIL = 100;
const MAX_TAIL = 10000;

function resolveTail(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_TAIL;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new AxiError(
      "--tail must be a positive integer",
      "VALIDATION_ERROR",
      [],
    );
  }
  return Math.min(Math.trunc(parsed), MAX_TAIL);
}

/**
 * `deployment.readLogs` = BUILD logs only (trap 4). Runtime container logs
 * are WebSocket-only and out of scope — the output says so explicitly so an
 * agent doesn't mistake this for app-level logging.
 */
export async function logsCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const rest = [...args];
  const deploymentFlag = takeFlag(rest, "--deployment");
  const tailFlag = takeFlag(rest, "--tail");
  const name = rest[0];

  if (!name) {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi logs <NAME>`",
    ]);
  }

  const tail = resolveTail(tailFlag);
  const ref = await resolveService(ctx, name);

  let deploymentId = deploymentFlag;
  if (!deploymentId) {
    const deployments = await listDeployments(ctx, ref);
    const latest = deployments[0];
    if (!latest) {
      throw new AxiError(
        `No deployment recorded yet for \`${ref.name}\` — nothing to read logs from`,
        "NOT_FOUND",
        ["Run `dokploy-axi deployments " + ref.name + "` to check"],
      );
    }
    deploymentId = latest.deploymentId;
  }

  const logs = await dokployGet<string>(ctx, "deployment.readLogs", {
    deploymentId,
    tail,
  });

  return [
    `build/deployment logs[${ref.name}] deployment=${deploymentId} tail=${tail}`,
    "(these are BUILD logs, not runtime application logs — runtime logs are WebSocket-only and out of scope)",
    "",
    logs?.trim() ? logs : "(empty)",
  ].join("\n");
}
