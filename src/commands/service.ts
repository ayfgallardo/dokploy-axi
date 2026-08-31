import type { DokployContext } from "../config.js";
import { dokployGet } from "../dokploy.js";
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
