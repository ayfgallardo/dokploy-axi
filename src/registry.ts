import type { DokployContext } from "./config.js";
import { dokployGet } from "./dokploy.js";
import { AxiError } from "./errors.js";

export type ServiceKind = "compose" | "application";

export interface ServiceRef {
  kind: ServiceKind;
  /** `composeId` or `applicationId` — the only handle the API takes. */
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

interface RawService {
  composeId?: string;
  applicationId?: string;
  name?: string;
  composeStatus?: string;
  applicationStatus?: string;
}

interface RawEnvironment {
  environmentId?: string;
  name?: string;
  compose?: RawService[];
  applications?: RawService[];
}

interface RawProject {
  projectId?: string;
  name?: string;
  environments?: RawEnvironment[];
}

const cache = new Map<string, ServiceRef[]>();

/** The cache lives for one CLI invocation; tests reset it between cases. */
export function clearRegistryCache(): void {
  cache.clear();
}

function collect(project: RawProject): ServiceRef[] {
  const services: ServiceRef[] = [];
  for (const environment of project.environments ?? []) {
    const common = {
      projectId: project.projectId ?? "",
      projectName: project.name ?? "",
      environmentId: environment.environmentId ?? "",
      environmentName: environment.name ?? "",
    };
    for (const raw of environment.compose ?? []) {
      services.push({
        kind: "compose",
        id: raw.composeId ?? "",
        name: raw.name ?? "",
        status: raw.composeStatus ?? "unknown",
        ...common,
      });
    }
    for (const raw of environment.applications ?? []) {
      services.push({
        kind: "application",
        id: raw.applicationId ?? "",
        name: raw.name ?? "",
        status: raw.applicationStatus ?? "unknown",
        ...common,
      });
    }
  }
  return services;
}

/**
 * Every compose and application of the configured project, across environments.
 * `appName` is deliberately dropped: it carries a random suffix and Dokploy
 * silently ignores it on writes.
 */
export async function listServices(ctx: DokployContext): Promise<ServiceRef[]> {
  const cached = cache.get(ctx.projectName);
  if (cached) {
    return cached;
  }

  const projects = await dokployGet<RawProject[]>(ctx, "project.all");
  const project = (projects ?? []).find((p) => p.name === ctx.projectName);
  if (!project) {
    const available = (projects ?? [])
      .map((p) => p.name)
      .filter((name): name is string => Boolean(name));
    throw new AxiError(
      `No Dokploy project named \`${ctx.projectName}\``,
      "NOT_FOUND",
      [
        available.length > 0
          ? `Available projects: ${available.join(", ")}`
          : "This API key sees no project at all",
        "Fix `projectName` with `dokploy-axi setup`",
      ],
    );
  }

  const services = collect(project);
  cache.set(ctx.projectName, services);
  return services;
}

function describe(service: ServiceRef): string {
  return `${service.name} (${service.kind}, env ${service.environmentName})`;
}

/** Resolve a service by its NAME — never by `appName`. */
export async function resolveService(
  ctx: DokployContext,
  name: string,
): Promise<ServiceRef> {
  const wanted = name.trim();
  if (wanted === "") {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi service list` to see the names",
    ]);
  }

  const services = await listServices(ctx);
  const matches = services.filter((service) => service.name === wanted);

  if (matches.length === 0) {
    throw new AxiError(
      `No service named \`${wanted}\` in project ${ctx.projectName}`,
      "NOT_FOUND",
      [
        `Available services: ${services.map((s) => s.name).join(", ")}`,
        "Run `dokploy-axi service list` for their status",
      ],
    );
  }

  if (matches.length > 1) {
    throw new AxiError(
      `\`${wanted}\` is ambiguous in project ${ctx.projectName}`,
      "VALIDATION_ERROR",
      [`Candidates: ${matches.map(describe).join(", ")}`],
    );
  }

  return matches[0];
}
