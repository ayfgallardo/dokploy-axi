import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  resolveContext: () => ({
    url: "https://dokploy.example.com",
    projectName: "example-project",
    apiKey: "fake-api-key",
  }),
  configPath: () => "/tmp/dokploy-axi/config.json",
}));

const homeCommandMock = vi.fn(async () => "home-ok");
vi.mock("../src/commands/home.js", () => ({ homeCommand: homeCommandMock }));

const serviceListCommandMock = vi.fn(async () => "service-list-ok");
const serviceViewCommandMock = vi.fn(async () => "service-view-ok");
vi.mock("../src/commands/service.js", () => ({
  serviceListCommand: serviceListCommandMock,
  serviceViewCommand: serviceViewCommandMock,
}));

const deploymentsCommandMock = vi.fn(async () => "deployments-ok");
vi.mock("../src/commands/deployments.js", () => ({
  deploymentsCommand: deploymentsCommandMock,
}));

const logsCommandMock = vi.fn(async () => "logs-ok");
vi.mock("../src/commands/logs.js", () => ({ logsCommand: logsCommandMock }));

const envViewCommandMock = vi.fn(async () => "env-view-ok");
vi.mock("../src/commands/env.js", () => ({
  envViewCommand: envViewCommandMock,
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
      "home",
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

  it("accepts `home` literally, like the no-args invocation", async () => {
    homeCommandMock.mockClear();

    const output = await run(["home"]);

    expect(output).toContain("home-ok");
    expect(homeCommandMock).toHaveBeenCalledTimes(1);
  });

  it("wires no-args to the same home handler", async () => {
    homeCommandMock.mockClear();

    const output = await run([]);

    expect(output).toContain("home-ok");
    expect(homeCommandMock).toHaveBeenCalledTimes(1);
  });

  it("wires the real read command handlers", async () => {
    homeCommandMock.mockClear();
    serviceListCommandMock.mockClear();
    serviceViewCommandMock.mockClear();
    deploymentsCommandMock.mockClear();
    logsCommandMock.mockClear();
    envViewCommandMock.mockClear();

    expect(await run(["service", "list"])).toContain("service-list-ok");
    expect(await run(["service", "view", "api-example"])).toContain(
      "service-view-ok",
    );
    expect(await run(["deployments", "api-example"])).toContain(
      "deployments-ok",
    );
    expect(await run(["logs", "api-example"])).toContain("logs-ok");
    expect(await run(["env", "view", "api-example"])).toContain("env-view-ok");

    expect(serviceListCommandMock).toHaveBeenCalledTimes(1);
    expect(serviceViewCommandMock).toHaveBeenCalledTimes(1);
    expect(deploymentsCommandMock).toHaveBeenCalledTimes(1);
    expect(logsCommandMock).toHaveBeenCalledTimes(1);
    expect(envViewCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe("stubs", () => {
  it("answers every mutation and unimplemented command with a clear not-implemented error", async () => {
    for (const argv of [["api", "project.all"], ["setup"]]) {
      expect(await run(argv)).toMatch(/not implemented yet/);
    }
  });

  it("routes each service write subcommand to a not-implemented stub", async () => {
    for (const sub of ["deploy", "redeploy", "start", "stop", "pin", "unpin"]) {
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
