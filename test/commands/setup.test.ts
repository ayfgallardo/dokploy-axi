import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { setupCommand } = await import("../../src/commands/setup.js");

function configPath(): string {
  return join(home.value, ".config", "dokploy-axi", "config.json");
}

describe("setupCommand", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-setup-"));
    vi.stubEnv("DOKPLOY_URL", undefined);
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("writes a fresh config with --url and --project, mode 600/700", async () => {
    const output = await setupCommand([
      "--url",
      "https://dokploy.example.com/",
      "--project",
      "example-project",
    ]);

    const written = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(written).toEqual({
      url: "https://dokploy.example.com",
      projectName: "example-project",
    });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(
      statSync(join(home.value, ".config", "dokploy-axi")).mode & 0o777,
    ).toBe(0o700);
    expect(output).toContain("config_written");
  });

  it("never writes or mentions an API key", async () => {
    const output = await setupCommand([
      "--url",
      "https://dokploy.example.com",
      "--project",
      "example-project",
    ]);

    const written = readFileSync(configPath(), "utf-8");
    expect(written).not.toMatch(/apiKey|DOKPLOY_API_KEY=/);
    expect(output.toLowerCase()).toContain("dokploy_api_key");
  });

  it("shows the current config state with no flags", async () => {
    await setupCommand([
      "--url",
      "https://dokploy.example.com",
      "--project",
      "example-project",
    ]);

    const output = await setupCommand([]);

    expect(output).toContain("dokploy.example.com");
    expect(output).toContain("example-project");
  });

  it("shows guidance with no flags and no existing config", async () => {
    const output = await setupCommand([]);

    expect(output.toLowerCase()).toMatch(/setup --url/);
  });

  it("requires --url on first-time setup", async () => {
    await expect(
      setupCommand(["--project", "example-project"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires --project on first-time setup", async () => {
    await expect(
      setupCommand(["--url", "https://dokploy.example.com"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps the existing field when only one flag is given on update", async () => {
    await setupCommand([
      "--url",
      "https://dokploy.example.com",
      "--project",
      "example-project",
    ]);

    await setupCommand(["--project", "other-project"]);

    const written = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(written).toEqual({
      url: "https://dokploy.example.com",
      projectName: "other-project",
    });
  });
});
