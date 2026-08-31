import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AUTH_HELP, AxiError } from "./errors.js";

export interface DokployConfig {
  /** Base URL without a trailing slash, e.g. `https://dokploy.example.com`. */
  url: string;
  /** Name of the single Dokploy project this CLI operates on. */
  projectName: string;
}

export interface DokployContext extends DokployConfig {
  /** Read from `DOKPLOY_API_KEY` only — never stored in the config file. */
  apiKey: string;
}

const SETUP_HELP = ["Run `dokploy-axi setup` to create it"];

export function configDir(): string {
  return join(homedir(), ".config", "dokploy-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function loadConfig(): DokployConfig {
  const path = configPath();

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new AxiError(
      `No Dokploy configuration in ${path}`,
      "CONFIG_MISSING",
      SETUP_HELP,
    );
  }

  let parsed: Partial<DokployConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<DokployConfig>;
  } catch {
    throw new AxiError(
      `Malformed Dokploy configuration in ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  const override = process.env["DOKPLOY_URL"];
  const url = override?.trim() ? trimUrl(override) : trimUrl(parsed.url ?? "");
  if (url === "") {
    throw new AxiError(`Missing \`url\` field in ${path}`, "VALIDATION_ERROR", [
      ...SETUP_HELP,
      "Or set DOKPLOY_URL for a one-off server",
    ]);
  }

  const projectName = parsed.projectName?.trim() ?? "";
  if (projectName === "") {
    throw new AxiError(
      `Missing \`projectName\` field in ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  return { url, projectName };
}

/** A shell that never expanded the variable hands us its literal spelling. */
function looksUninterpolated(value: string): boolean {
  return /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value);
}

export function resolveApiKey(): string {
  const value = process.env["DOKPLOY_API_KEY"]?.trim() ?? "";

  if (value === "") {
    throw new AxiError(
      "No Dokploy API key: DOKPLOY_API_KEY is not set",
      "AUTH_REQUIRED",
      AUTH_HELP,
    );
  }

  if (looksUninterpolated(value)) {
    throw new AxiError(
      `DOKPLOY_API_KEY holds the literal string \`${value}\` — the variable was never interpolated`,
      "AUTH_REQUIRED",
      [
        "A single-quoted assignment or a config template kept the placeholder as-is",
        ...AUTH_HELP,
      ],
    );
  }

  return value;
}

export function resolveContext(): DokployContext {
  return { ...loadConfig(), apiKey: resolveApiKey() };
}
