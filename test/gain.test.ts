import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const {
  flushGain,
  gainCommandName,
  gainLogPath,
  gainStdout,
  readGainLog,
  recordRawBody,
  startGain,
} = await import("../src/gain.js");
const { gainCommand } = await import("../src/commands/gain.js");

const RAW = JSON.stringify({
  composes: [{ composeId: "abc-123", name: "api-dossiers", branch: "main" }],
});

/**
 * `dataDir()` picks a different branch per platform, so a runner only ever
 * exercises one of them. Stubbing the platform lets a single test cover both.
 */
function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  return () => {
    Object.defineProperty(process, "platform", original as PropertyDescriptor);
  };
}

function readLines(): string[] {
  return readFileSync(gainLogPath(), "utf-8").trim().split("\n");
}

describe("gain recorder", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-gain-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
    vi.stubEnv("AXI_GAIN", "");
    startGain();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("stores the log under the platform data directory", () => {
    expect(gainLogPath().startsWith(home.value)).toBe(true);
    expect(gainLogPath().endsWith(join("axi", "dokploy-axi.jsonl"))).toBe(true);
  });

  it("records raw response tokens minus rendered output tokens", async () => {
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write(
      "services[1]{name,branch}:\n  api-dossiers,main\n",
    );

    await flushGain("service list");

    const entry = JSON.parse(readLines()[0]);
    expect(entry.cli).toBe("dokploy-axi");
    expect(entry.cmd).toBe("service list");
    expect(entry.raw).toBeGreaterThan(entry.out);
    expect(entry.out).toBeGreaterThan(0);
  });

  it("writes one append-only JSONL line per invocation", async () => {
    recordRawBody(RAW);
    await flushGain("home");
    startGain();
    recordRawBody(RAW);
    await flushGain("logs");

    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual([
      "ts",
      "cli",
      "cmd",
      "raw",
      "out",
      "ms",
    ]);
    const entry = JSON.parse(lines[1]);
    expect(entry.cmd).toBe("logs");
    expect(Number.isInteger(entry.ts)).toBe(true);
    expect(Number.isInteger(entry.ms)).toBe(true);
  });

  it("cumulates every HTTP response of the invocation", async () => {
    recordRawBody(RAW);
    await flushGain("home");
    const single = JSON.parse(readLines()[0]).raw;

    startGain();
    recordRawBody(RAW);
    recordRawBody(RAW);
    await flushGain("home");

    expect(JSON.parse(readLines()[1]).raw).toBeGreaterThan(single);
  });

  it("records nothing when AXI_GAIN=0", async () => {
    vi.stubEnv("AXI_GAIN", "0");
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write("out");

    await flushGain("home");

    expect(readGainLog()).toEqual([]);
  });

  it("records nothing for an invocation that issued no request", async () => {
    await flushGain("setup");

    expect(readGainLog()).toEqual([]);
  });

  it("never leaks arguments, flag values or service names", async () => {
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write("deployments[0]:\n");

    await flushGain(
      gainCommandName(
        ["logs", "api-dossiers", "--deployment", "dep-42", "--tail", "500"],
        ["logs"],
      ),
    );

    const line = readLines()[0];
    for (const secret of [
      "api-dossiers",
      "--deployment",
      "dep-42",
      "--tail",
      "500",
      "abc-123",
    ]) {
      expect(line).not.toContain(secret);
    }
  });

  it("only records a command name the CLI itself defines", () => {
    expect(gainCommandName([], ["home"])).toBe("home");
    expect(gainCommandName(["logs"], ["logs"])).toBe("logs");
    expect(gainCommandName(["api-dossiers"], ["logs"])).toBeUndefined();
  });

  it("records a subcommand only when it too comes from a closed list", () => {
    const subcommands = { service: ["list", "view"] };
    expect(gainCommandName(["service", "view"], ["service"], subcommands)).toBe(
      "service view",
    );
    expect(
      gainCommandName(["service", "api-dossiers"], ["service"], subcommands),
    ).toBe("service");
  });

  for (const platform of ["darwin", "linux"] as const) {
    it(`keeps the command output intact when the log cannot be written on ${platform}`, async () => {
      const restorePlatform = stubPlatform(platform);
      try {
        const stdout = {
          chunks: [] as string[],
          write(chunk: string) {
            this.chunks.push(chunk);
            return true;
          },
        };
        const tee = gainStdout(stdout);
        tee.write("rendered output\n");
        recordRawBody(RAW);
        // A plain file where the data directory belongs, derived from the very
        // path production uses, so the block survives a change of layout.
        const dataDir = dirname(gainLogPath());
        mkdirSync(dirname(dataDir), { recursive: true });
        writeFileSync(dataDir, "");

        await expect(flushGain("home")).resolves.toBeUndefined();
        expect(stdout.chunks).toEqual(["rendered output\n"]);
        expect(process.exitCode).toBeUndefined();
      } finally {
        restorePlatform();
      }
    });
  }

  it("ignores malformed lines when reading the log", async () => {
    recordRawBody(RAW);
    await flushGain("home");
    const path = gainLogPath();
    writeFileSync(path, `${readFileSync(path, "utf-8")}not json\n{}\n`);

    expect(readGainLog()).toHaveLength(1);
  });
});

describe("gain command", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "dokploy-axi-gain-cmd-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  function seed(entries: object[]): void {
    const path = gainLogPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
  }

  it("reports a clear message on an absent log", async () => {
    const output = await gainCommand();
    expect(output).toContain("no invocation recorded yet");
  });

  it("totals savings and breaks them down per sub-command", async () => {
    seed([
      {
        ts: 1788280000,
        cli: "dokploy-axi",
        cmd: "home",
        raw: 400,
        out: 100,
        ms: 300,
      },
      {
        ts: 1788280100,
        cli: "dokploy-axi",
        cmd: "home",
        raw: 600,
        out: 200,
        ms: 300,
      },
      {
        ts: 1788280200,
        cli: "dokploy-axi",
        cmd: "service view",
        raw: 9000,
        out: 1500,
        ms: 400,
      },
    ]);

    const output = await gainCommand();

    expect(output).toContain("invocations: 3");
    expect(output).toContain("raw_tokens: 10000");
    expect(output).toContain("out_tokens: 1800");
    expect(output).toContain("saved_tokens: 8200");
    expect(output).toContain("saved_pct: 82");
    expect(output).toContain("service view,1,9000,1500,7500,83.3");
    expect(output).toContain("home,2,1000,300,700,70");
  });

  it("reads the oldest timestamp without spreading the log into a call", async () => {
    seed(
      Array.from({ length: 200000 }, (_, index) => ({
        ts: 1788280000 + index,
        cli: "dokploy-axi",
        cmd: "home",
        raw: 10,
        out: 2,
        ms: 1,
      })),
    );

    const output = await gainCommand();

    expect(output).toContain("invocations: 200000");
    expect(output).toContain("since: 2026-09-01");
  });
});
