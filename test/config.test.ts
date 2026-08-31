import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { configPath, loadConfig, resolveApiKey, resolveContext } =
  await import("../src/config.js");
const { AxiError } = await import("../src/errors.js");

function writeConfig(content: string): void {
  const dir = join(home.value, ".config", "dokploy-axi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), content);
}

function thrownBy(run: () => unknown): InstanceType<typeof AxiError> {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    return error as InstanceType<typeof AxiError>;
  }
  throw new Error("expected the call to throw");
}

describe("config file", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-config-"));
    vi.stubEnv("DOKPLOY_URL", undefined);
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("resolves the config under ~/.config/dokploy-axi", () => {
    expect(configPath()).toBe(
      join(home.value, ".config", "dokploy-axi", "config.json"),
    );
  });

  it("loads url and projectName", () => {
    writeConfig(
      JSON.stringify({
        url: "https://dokploy.example.com",
        projectName: "example-project",
      }),
    );

    expect(loadConfig()).toEqual({
      url: "https://dokploy.example.com",
      projectName: "example-project",
    });
  });

  it("strips a trailing slash from the url", () => {
    writeConfig(
      JSON.stringify({
        url: "https://dokploy.example.com/",
        projectName: "example-project",
      }),
    );

    expect(loadConfig().url).toBe("https://dokploy.example.com");
  });

  it("lets DOKPLOY_URL override the configured url", () => {
    writeConfig(
      JSON.stringify({
        url: "https://dokploy.example.com",
        projectName: "example-project",
      }),
    );
    vi.stubEnv("DOKPLOY_URL", "https://other.example.com/");

    expect(loadConfig().url).toBe("https://other.example.com");
  });

  it("guides towards setup when the file is missing", () => {
    const error = thrownBy(loadConfig);

    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.suggestions.join(" ")).toContain("dokploy-axi setup");
  });

  it("guides towards setup when the file is malformed", () => {
    writeConfig("{ not json");

    expect(thrownBy(loadConfig).code).toBe("VALIDATION_ERROR");
  });

  it("rejects a config without a projectName", () => {
    writeConfig(JSON.stringify({ url: "https://dokploy.example.com" }));

    expect(thrownBy(loadConfig).code).toBe("VALIDATION_ERROR");
  });

  it("rejects a config without a url and no DOKPLOY_URL", () => {
    writeConfig(JSON.stringify({ projectName: "example-project" }));

    expect(thrownBy(loadConfig).code).toBe("VALIDATION_ERROR");
  });
});

describe("api key", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the key from DOKPLOY_API_KEY", () => {
    vi.stubEnv("DOKPLOY_API_KEY", "fake-api-key");

    expect(resolveApiKey()).toBe("fake-api-key");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("DOKPLOY_API_KEY", "  fake-api-key\n");

    expect(resolveApiKey()).toBe("fake-api-key");
  });

  it("asks the user to export the key when it is absent", () => {
    vi.stubEnv("DOKPLOY_API_KEY", undefined);

    const error = thrownBy(resolveApiKey);

    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions.join(" ")).toContain("export DOKPLOY_API_KEY=");
  });

  it("treats an empty key as absent", () => {
    vi.stubEnv("DOKPLOY_API_KEY", "   ");

    expect(thrownBy(resolveApiKey).code).toBe("AUTH_REQUIRED");
  });

  it("reports an uninterpolated ${DOKPLOY_API_KEY} literal as such", () => {
    vi.stubEnv("DOKPLOY_API_KEY", "${DOKPLOY_API_KEY}");

    const error = thrownBy(resolveApiKey);

    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.message).toContain("${DOKPLOY_API_KEY}");
    expect(error.message.toLowerCase()).toContain("interpolat");
  });

  it("reports an uninterpolated $DOKPLOY_API_KEY literal as such", () => {
    vi.stubEnv("DOKPLOY_API_KEY", "$DOKPLOY_API_KEY");

    expect(thrownBy(resolveApiKey).message.toLowerCase()).toContain(
      "interpolat",
    );
  });
});

describe("resolveContext", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-context-"));
    vi.stubEnv("DOKPLOY_URL", undefined);
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("combines the config file and the environment key", () => {
    writeConfig(
      JSON.stringify({
        url: "https://dokploy.example.com",
        projectName: "example-project",
      }),
    );
    vi.stubEnv("DOKPLOY_API_KEY", "fake-api-key");

    expect(resolveContext()).toEqual({
      url: "https://dokploy.example.com",
      projectName: "example-project",
      apiKey: "fake-api-key",
    });
  });
});
