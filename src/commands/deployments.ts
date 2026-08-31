import type { DokployContext } from "../config.js";
import { dokployGet } from "../dokploy.js";
import { AxiError } from "../errors.js";
import { resolveService, type ServiceRef } from "../registry.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";

export interface Deployment {
  deploymentId: string;
  title?: string | null;
  description?: string | null;
  status: string;
  createdAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

interface ApplicationOne {
  deployments?: Deployment[];
}

/**
 * Composes have a dedicated, already-sorted history endpoint; applications
 * only expose their history nested in `application.one`, in no guaranteed
 * order, so it is sorted here.
 */
export async function listDeployments(
  ctx: DokployContext,
  ref: ServiceRef,
): Promise<Deployment[]> {
  if (ref.kind === "compose") {
    return dokployGet<Deployment[]>(ctx, "deployment.allByCompose", {
      composeId: ref.id,
    });
  }

  const application = await dokployGet<ApplicationOne>(ctx, "application.one", {
    applicationId: ref.id,
  });
  return [...(application.deployments ?? [])].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

function firstLine(text: string | null | undefined): string {
  return (text ?? "").split("\n")[0] ?? "";
}

function commitOf(description: string | null | undefined): string {
  const match = description?.match(/Commit: ([0-9a-f]+)/);
  return match ? match[1].slice(0, 8) : "unknown";
}

export async function deploymentsCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const name = args[0];
  if (!name) {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi deployments <NAME>`",
    ]);
  }

  const ref = await resolveService(ctx, name);
  const deployments = await listDeployments(ctx, ref);

  if (deployments.length === 0) {
    return renderOutput([
      `deployments: no deployment recorded yet for \`${ref.name}\``,
      renderHelp(getSuggestions({ name: ref.name, status: ref.status })),
    ]);
  }

  return renderOutput([
    renderList(`deployments[${ref.name}]`, deployments, [
      field("deploymentId", "id"),
      custom("title", (d: Deployment) => firstLine(d.title)),
      custom("commit", (d: Deployment) => commitOf(d.description)),
      field("status"),
      field("createdAt"),
      field("finishedAt"),
    ]),
    renderHelp(getSuggestions({ name: ref.name, status: ref.status })),
  ]);
}
