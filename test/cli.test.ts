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
const serviceDeployCommandMock = vi.fn(async () => "service-deploy-ok");
const serviceRedeployCommandMock = vi.fn(async () => "service-redeploy-ok");
const serviceStartCommandMock = vi.fn(async () => "service-start-ok");
const serviceStopCommandMock = vi.fn(async () => "service-stop-ok");
const servicePinCommandMock = vi.fn(async () => "service-pin-ok");
const serviceUnpinCommandMock = vi.fn(async () => "service-unpin-ok");
vi.mock("../src/commands/service.js", () => ({
  serviceListCommand: serviceListCommandMock,
  serviceViewCommand: serviceViewCommandMock,
  serviceDeployCommand: serviceDeployCommandMock,
  serviceRedeployCommand: serviceRedeployCommandMock,
  serviceStartCommand: serviceStartCommandMock,
  serviceStopCommand: serviceStopCommandMock,
  servicePinCommand: servicePinCommandMock,
  serviceUnpinCommand: serviceUnpinCommandMock,
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

const apiCommandMock = vi.fn(async () => "api-ok");
vi.mock("../src/commands/api.js", () => ({ apiCommand: apiCommandMock }));

const setupCommandMock = vi.fn(async () => "setup-ok");
vi.mock("../src/commands/setup.js", () => ({
  setupCommand: setupCommandMock,
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
    expect(await run(["api", "project.all"])).toContain("api-ok");
    expect(await run(["setup"])).toContain("setup-ok");

    expect(serviceListCommandMock).toHaveBeenCalledTimes(1);
    expect(serviceViewCommandMock).toHaveBeenCalledTimes(1);
    expect(deploymentsCommandMock).toHaveBeenCalledTimes(1);
    expect(logsCommandMock).toHaveBeenCalledTimes(1);
    expect(envViewCommandMock).toHaveBeenCalledTimes(1);
    expect(apiCommandMock).toHaveBeenCalledTimes(1);
    expect(setupCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe("service mutation wiring", () => {
  it("routes each write subcommand to its real handler", async () => {
    expect(await run(["service", "deploy", "api-example"])).toContain(
      "service-deploy-ok",
    );
    expect(await run(["service", "redeploy", "api-example"])).toContain(
      "service-redeploy-ok",
    );
    expect(await run(["service", "start", "api-example"])).toContain(
      "service-start-ok",
    );
    expect(await run(["service", "stop", "api-example"])).toContain(
      "service-stop-ok",
    );
    expect(await run(["service", "pin", "api-example", "feature/x"])).toContain(
      "service-pin-ok",
    );
    expect(await run(["service", "unpin", "api-example"])).toContain(
      "service-unpin-ok",
    );
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
