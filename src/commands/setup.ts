import { mkdirSync, writeFileSync } from "node:fs";
import { encode } from "@toon-format/toon";
import { takeFlag } from "../args.js";
import {
  configDir,
  configPath,
  loadConfig,
  type DokployConfig,
} from "../config.js";
import { AxiError } from "../errors.js";
import { renderHelp, renderOutput } from "../toon.js";

const KEY_REMINDER =
  "DOKPLOY_API_KEY is read from the environment only — export it, this file never stores it";

type ConfigState =
  | { kind: "missing" }
  | { kind: "corrupt"; message: string }
  | { kind: "ok"; config: DokployConfig };

/** Distinguishes "no config yet" from "a config file exists but can't be read" — a
 * partial update (one flag only) needs to explain which case it hit, not silently
 * fall back to "first-time setup" wording when a file is actually there but broken. */
function currentConfigState(): ConfigState {
  try {
    return { kind: "ok", config: loadConfig() };
  } catch (error) {
    if (error instanceof AxiError && error.code === "CONFIG_MISSING") {
      return { kind: "missing" };
    }
    return {
      kind: "corrupt",
      message: error instanceof AxiError ? error.message : String(error),
    };
  }
}

function renderConfig(label: string, config: DokployConfig): string {
  return encode({
    [label]: { url: config.url, projectName: config.projectName },
  });
}

/**
 * Writes `~/.config/dokploy-axi/config.json` (url + projectName only). Never
 * writes or accepts an API key — `DOKPLOY_API_KEY` always comes from the env.
 */
export async function setupCommand(args: string[]): Promise<string> {
  const rest = [...args];
  const url = takeFlag(rest, "--url");
  const project = takeFlag(rest, "--project");

  const changesConfig = url !== undefined || project !== undefined;

  const state = currentConfigState();

  if (!changesConfig) {
    if (state.kind === "missing") {
      return renderOutput([
        "config: absent",
        renderHelp([
          "Create it: dokploy-axi setup --url <url> --project <name>",
        ]),
      ]);
    }
    if (state.kind === "corrupt") {
      throw new AxiError(
        `Existing config is unreadable: ${state.message}`,
        "VALIDATION_ERROR",
        ["Run `dokploy-axi setup --url <url> --project <name>` to rewrite it"],
      );
    }
    return renderOutput([
      renderConfig("config", state.config),
      renderHelp([KEY_REMINDER]),
    ]);
  }

  const existing = state.kind === "ok" ? state.config : undefined;
  const resolvedUrl = url?.trim().replace(/\/+$/, "") || existing?.url;
  const resolvedProject = project?.trim() || existing?.projectName;

  if (!resolvedUrl || !resolvedProject) {
    if (state.kind === "corrupt") {
      throw new AxiError(
        `Existing config is unreadable (${state.message}) — provide both --url and --project to rewrite it`,
        "VALIDATION_ERROR",
        ["Run `dokploy-axi setup --url <url> --project <name>`"],
      );
    }
    if (!resolvedUrl) {
      throw new AxiError(
        "--url is required for first-time setup",
        "VALIDATION_ERROR",
        ["Run `dokploy-axi setup --url <url> --project <name>`"],
      );
    }
    throw new AxiError(
      "--project is required for first-time setup",
      "VALIDATION_ERROR",
      ["Run `dokploy-axi setup --url <url> --project <name>`"],
    );
  }

  const next: DokployConfig = {
    url: resolvedUrl,
    projectName: resolvedProject,
  };

  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  return renderOutput([
    `config_written: ${path}`,
    renderConfig("config", next),
    renderHelp([KEY_REMINDER]),
  ]);
}
