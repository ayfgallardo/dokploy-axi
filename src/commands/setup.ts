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

function currentConfig(): DokployConfig | undefined {
  try {
    return loadConfig();
  } catch {
    return undefined;
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

  if (!changesConfig) {
    const existing = currentConfig();
    if (!existing) {
      return renderOutput([
        "config: absent",
        renderHelp([
          "Create it: dokploy-axi setup --url <url> --project <name>",
        ]),
      ]);
    }
    return renderOutput([
      renderConfig("config", existing),
      renderHelp([KEY_REMINDER]),
    ]);
  }

  const existing = currentConfig();
  const resolvedUrl = url?.trim().replace(/\/+$/, "") || existing?.url;
  const resolvedProject = project?.trim() || existing?.projectName;

  if (!resolvedUrl) {
    throw new AxiError(
      "--url is required for first-time setup",
      "VALIDATION_ERROR",
      ["Run `dokploy-axi setup --url <url> --project <name>`"],
    );
  }
  if (!resolvedProject) {
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
