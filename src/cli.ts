import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { apiCommand } from "./commands/api.js";
import { deploymentsCommand } from "./commands/deployments.js";
import { envViewCommand } from "./commands/env.js";
import { homeCommand } from "./commands/home.js";
import { logsCommand } from "./commands/logs.js";
import {
  serviceDeployCommand,
  serviceListCommand,
  servicePinCommand,
  serviceRedeployCommand,
  serviceStartCommand,
  serviceStopCommand,
  serviceUnpinCommand,
  serviceViewCommand,
} from "./commands/service.js";
import { setupCommand } from "./commands/setup.js";
import type { DokployContext } from "./config.js";
import { resolveContext } from "./config.js";
import { AxiError, exitCodeForError } from "./errors.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for Dokploy. Prefer this over raw `curl` calls to the Dokploy API.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const COMMAND_NAMES = [
  "home",
  "service",
  "deployments",
  "logs",
  "env",
  "api",
  "setup",
] as const;

export const SERVICE_SUBCOMMANDS = [
  "list",
  "view",
  "deploy",
  "redeploy",
  "start",
  "stop",
  "pin",
  "unpin",
] as const;

/** `env` is read-only: writes go through the Dokploy UI (trap 6). */
export const ENV_SUBCOMMANDS = ["view"] as const;

export const TOP_HELP = `usage: dokploy-axi [command] [args] [flags]
commands[${COMMAND_NAMES.length}]:
  ${COMMAND_NAMES.join(", ")} — no args runs home
service[${SERVICE_SUBCOMMANDS.length}]:
  ${SERVICE_SUBCOMMANDS.join(", ")}
env[${ENV_SUBCOMMANDS.length}]:
  ${ENV_SUBCOMMANDS.join(", ")}
flags[2]:
  --help, -v/-V/--version
examples:
  dokploy-axi
  dokploy-axi service list
  dokploy-axi service view <NAME>
  dokploy-axi service deploy <NAME> --watch
  dokploy-axi service pin <NAME> <BRANCH>
  dokploy-axi service unpin <NAME>
  dokploy-axi deployments <NAME>
  dokploy-axi logs <NAME>
  dokploy-axi env view <NAME>
  dokploy-axi api compose.one --input '{"composeId":"<ID>"}'
  dokploy-axi setup --url https://dokploy.example.com --project <NAME>
`;

const COMMAND_HELP: Record<string, string> = {
  home: "usage: dokploy-axi home (same as `dokploy-axi` with no args)\n",
  service: `usage: dokploy-axi service <${SERVICE_SUBCOMMANDS.join("|")}> [NAME] [args]\n`,
  deployments: "usage: dokploy-axi deployments <NAME>\n",
  logs: "usage: dokploy-axi logs <NAME> [--deployment <ID>] [--tail <N>]\n",
  env: "usage: dokploy-axi env view <NAME>\n",
  api: "usage: dokploy-axi api <router.procedure> [--input <json>] [--allow-mutation]\n",
  setup: "usage: dokploy-axi setup [--url <url>] [--project <name>]\n",
};

type CommandFn = (
  args: string[],
  ctx: DokployContext | undefined,
) => Promise<string>;

/** Placeholder until the command tasks land their handlers. */
function notImplementedYet(name: string): CommandFn {
  return async () => {
    throw new AxiError(
      `\`dokploy-axi ${name}\` is not implemented yet`,
      "NOT_IMPLEMENTED",
      ["Run `dokploy-axi --help` to see what already works"],
    );
  };
}

/** `resolveContext` only answers `undefined` for `setup` — every other command gets a real context. */
function withContext(
  fn: (args: string[], ctx: DokployContext) => Promise<string>,
): CommandFn {
  return async (args, ctx) => {
    if (!ctx) {
      throw new AxiError("Internal error: missing Dokploy context", "UNKNOWN");
    }
    return fn(args, ctx);
  };
}

function routed(
  command: string,
  subcommands: readonly string[],
  handlers: Partial<Record<string, CommandFn>>,
  extraHelp: string[] = [],
): CommandFn {
  return async (args, ctx) => {
    const subcommand = args[0];
    if (subcommand === undefined || !subcommands.includes(subcommand)) {
      throw new AxiError(
        subcommand === undefined
          ? `\`dokploy-axi ${command}\` needs a subcommand`
          : `Unknown \`${command}\` subcommand: ${subcommand}`,
        "VALIDATION_ERROR",
        [`Valid subcommands: ${subcommands.join(", ")}`, ...extraHelp],
      );
    }
    const handler =
      handlers[subcommand] ?? notImplementedYet(`${command} ${subcommand}`);
    return handler(args.slice(1), ctx);
  };
}

const wrappedHome = withContext(homeCommand);

const COMMANDS: Record<string, CommandFn> = {
  // `dokploy-axi home` and `dokploy-axi` are the same view.
  home: wrappedHome,
  service: routed("service", SERVICE_SUBCOMMANDS, {
    list: withContext(serviceListCommand),
    view: withContext(serviceViewCommand),
    deploy: withContext(serviceDeployCommand),
    redeploy: withContext(serviceRedeployCommand),
    start: withContext(serviceStartCommand),
    stop: withContext(serviceStopCommand),
    pin: withContext(servicePinCommand),
    unpin: withContext(serviceUnpinCommand),
  }),
  deployments: withContext(deploymentsCommand),
  logs: withContext(logsCommand),
  env: routed("env", ENV_SUBCOMMANDS, { view: withContext(envViewCommand) }, [
    "`env` is read-only: change variables in the Dokploy UI — saveEnvironment replaces the whole block and drops SHARED_NETWORK",
  ]),
  api: withContext(apiCommand),
  setup: async (args) => setupCommand(args),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<DokployContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: wrappedHome,
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
    // `setup` writes the very configuration the other commands read.
    resolveContext: async ({ command }) =>
      command === "setup" ? undefined : resolveContext(),
  });
}
