import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  resolveContext: () => ({
    url: "https://dokploy.example.com",
    projectName: "example-project",
    apiKey: "fake-api-key",
  }),
  configPath: () => "/tmp/dokploy-axi/config.json",
}));

const { COMMAND_NAMES, ENV_SUBCOMMANDS, SERVICE_SUBCOMMANDS, TOP_HELP, main } =
  await import("../src/cli.js");

function capture(): {
  stdout: { write: (chunk: string) => void };
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    stdout: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(""),
  };
}

async function run(argv: string[]): Promise<string> {
  const out = capture();
  await main({ argv, stdout: out.stdout });
  return out.text();
}

describe("cli surface", () => {
  it("exposes exactly the planned commands", () => {
    expect([...COMMAND_NAMES]).toEqual([
      "service",
      "deployments",
      "logs",
      "env",
      "api",
      "setup",
    ]);
  });

  it("exposes exactly the planned service subcommands", () => {
    expect([...SERVICE_SUBCOMMANDS]).toEqual([
      "list",
      "view",
      "deploy",
      "redeploy",
      "start",
      "stop",
      "pin",
      "unpin",
    ]);
  });

  it("exposes `env view` only", () => {
    expect([...ENV_SUBCOMMANDS]).toEqual(["view"]);
  });

  it("lists every command and subcommand in the top-level help", () => {
    for (const name of [
      ...COMMAND_NAMES,
      ...SERVICE_SUBCOMMANDS,
      ...ENV_SUBCOMMANDS,
    ]) {
      expect(TOP_HELP).toContain(name);
    }
  });

  it("prints the version", async () => {
    expect((await run(["--version"])).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints the top-level help on --help", async () => {
    expect(await run(["--help"])).toContain("usage: dokploy-axi");
  });

  it("reports an unknown command", async () => {
    expect(await run(["nope"])).toMatch(/nope/);
  });
});

describe("stubs", () => {
  it("answers every command with a clear not-implemented error", async () => {
    for (const argv of [
      [],
      ["service", "list"],
      ["deployments"],
      ["logs"],
      ["env", "view"],
      ["api", "project.all"],
      ["setup"],
    ]) {
      expect(await run(argv)).toMatch(/not implemented yet/);
    }
  });

  it("routes each service subcommand", async () => {
    for (const sub of SERVICE_SUBCOMMANDS) {
      expect(await run(["service", sub, "api-example"])).toMatch(
        /not implemented yet/,
      );
    }
  });
});

describe("subcommand routing", () => {
  it("rejects an unknown service subcommand with the valid ones", async () => {
    const output = await run(["service", "nope"]);

    expect(output).toContain("VALIDATION_ERROR");
    expect(output).toContain("redeploy");
  });

  it("rejects `service` without a subcommand", async () => {
    expect(await run(["service"])).toContain("VALIDATION_ERROR");
  });

  it("refuses any env write and points at the UI", async () => {
    const output = await run(["env", "set", "FOO=bar"]);

    expect(output).toContain("VALIDATION_ERROR");
    expect(output.toLowerCase()).toContain("read-only");
  });
});
