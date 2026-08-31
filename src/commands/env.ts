import type { DokployContext } from "../config.js";
import { dokployGet } from "../dokploy.js";
import { AxiError } from "../errors.js";
import { resolveService } from "../registry.js";

interface EnvHolder {
  env?: string | null;
}

/**
 * Trap 6: `env` is read-only. `compose.update`/`saveEnvironment` replace the
 * whole block and drop `SHARED_NETWORK`, so writes go through the UI, never
 * this CLI.
 */
export async function envViewCommand(
  args: string[],
  ctx: DokployContext,
): Promise<string> {
  const name = args[0];
  if (!name) {
    throw new AxiError("A service name is required", "VALIDATION_ERROR", [
      "Run `dokploy-axi env view <NAME>`",
    ]);
  }

  const ref = await resolveService(ctx, name);
  const procedure = ref.kind === "compose" ? "compose.one" : "application.one";
  const params =
    ref.kind === "compose" ? { composeId: ref.id } : { applicationId: ref.id };

  const detail = await dokployGet<EnvHolder>(ctx, procedure, params);
  const env = detail.env?.trim();

  return [
    `env[${ref.name}] (read-only rendered environment):`,
    env ? env : "(empty)",
    "",
    "help[1]:",
    "  This is read-only — change variables in the Dokploy UI, not here",
  ].join("\n");
}
