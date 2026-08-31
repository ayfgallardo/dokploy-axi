import type { DokployContext } from "../config.js";
import { listServices } from "../registry.js";
import { getSuggestions } from "../suggestions.js";
import { field, renderHelp, renderList, renderOutput } from "../toon.js";
import { listDeployments } from "./deployments.js";
import { fetchServiceDetail } from "./service.js";

interface HomeRow {
  name: string;
  kind: string;
  status: string;
  gitlabBranch: string;
  lastDeploymentId: string;
  lastDeploymentStatus: string;
  lastDeploymentAt: string;
}

/**
 * THE "does dev have my version?" view: every service, its tracked branch and
 * its last deployment. A branch pinned away from `main` is flagged at the
 * very top — that's the one fact this view exists to surface fast.
 */
export async function homeCommand(
  _args: string[],
  ctx: DokployContext,
): Promise<string> {
  const services = await listServices(ctx);

  const rows: HomeRow[] = await Promise.all(
    services.map(async (ref) => {
      const [detail, deployments] = await Promise.all([
        fetchServiceDetail(ctx, ref),
        listDeployments(ctx, ref),
      ]);
      const last = deployments[0];
      return {
        name: ref.name,
        kind: ref.kind,
        status: ref.status,
        gitlabBranch: detail.gitlabBranch ?? "main",
        lastDeploymentId: last?.deploymentId ?? "none",
        lastDeploymentStatus: last?.status ?? "none",
        lastDeploymentAt: last?.createdAt ?? "none",
      };
    }),
  );

  const pinned = rows.filter((row) => row.gitlabBranch !== "main");
  const suggestions = rows.flatMap((row) =>
    getSuggestions({
      name: row.name,
      status: row.status,
      gitlabBranch: row.gitlabBranch,
    }),
  );

  const blocks: string[] = [];
  if (pinned.length > 0) {
    blocks.push(
      renderList("pinned (branch != main)", pinned, [
        field("name"),
        field("gitlabBranch", "branch"),
      ]),
    );
  }
  blocks.push(
    renderList("services", rows, [
      field("name"),
      field("kind"),
      field("status"),
      field("gitlabBranch", "branch"),
      field("lastDeploymentId"),
      field("lastDeploymentStatus"),
      field("lastDeploymentAt"),
    ]),
  );
  blocks.push(renderHelp(suggestions));

  return renderOutput(blocks);
}
