# dokploy-axi

Agent-ergonomic Dokploy CLI (AXI) — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps the Dokploy API directly (no third-party Dokploy client) with token-efficient TOON output, contextual next-step suggestions, and structured AXI error handling. Prefer this over raw `curl` calls against the Dokploy API.

## Why

A raw Dokploy API response is built for a UI, not an agent: full compose configs, build-arg blobs, per-deployment history entries, OAuth provider metadata — most of it irrelevant to a status check or a deploy trigger. `dokploy-axi` follows the [AXI](https://github.com/kunchenguid/axi) conventions: responses are encoded as [TOON](https://github.com/toon-format/toon) instead of raw JSON, every response carries contextual suggestions for the next command, and failures come back as structured errors instead of a stack trace.

## Install

Not published on npm — install from source:

```sh
git clone https://github.com/ayfgallardo/dokploy-axi
cd dokploy-axi
pnpm install
pnpm build
npm install -g .
```

### Prerequisites

- Node.js 20 or newer.
- A Dokploy API key: Dokploy → Settings → API/CLI. Export it as `DOKPLOY_API_KEY` — it is never stored on disk by this CLI.

## Setup

Run once per machine:

```sh
dokploy-axi setup --url https://dokploy.example.com --project <project-name>
```

This writes `~/.config/dokploy-axi/config.json` (server URL and project name only). `DOKPLOY_API_KEY` always comes from the environment; the config file never holds it. `DOKPLOY_URL` can override the configured URL for a one-off server without touching the file.

## Commands

| Command                                                                  | Purpose                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `dokploy-axi` / `dokploy-axi home`                                       | Dashboard: every service, its tracked branch, status and last deployment.      |
| `dokploy-axi service list`                                               | All composes and applications with status, branch, autoDeploy.                 |
| `dokploy-axi service view <NAME>`                                        | Detail: branch, watch paths, domains, docker services, last deployment.        |
| `dokploy-axi service deploy <NAME> [--watch] [--timeout <SECONDS>]`      | Trigger a build/deploy. `--watch` polls until `done`/`error`/`idle`. Mutation. |
| `dokploy-axi service redeploy <NAME> [--watch] [--timeout <SECONDS>]`    | Redeploy from the last build, same `--watch`. Mutation.                        |
| `dokploy-axi service start <NAME>` / `stop <NAME>`                       | Start/stop a compose service (no application equivalent). Mutation.            |
| `dokploy-axi service pin <NAME> <BRANCH>`                                | Track a feature branch instead of `main`. Mutation.                            |
| `dokploy-axi service unpin <NAME>`                                       | Return to `main` (an alias for `pin <NAME> main`). Mutation.                   |
| `dokploy-axi deployments <NAME>`                                         | Deployment history for a service.                                              |
| `dokploy-axi logs <NAME> [--deployment <ID>] [--tail <N>]`               | Build/deployment logs (not application runtime logs — see traps below).        |
| `dokploy-axi env view <NAME>`                                            | Rendered environment, read-only.                                               |
| `dokploy-axi api <router.procedure> [--input <json>] [--allow-mutation]` | Raw Dokploy API call, same AXI conventions. Mutation refused without the flag. |
| `dokploy-axi setup [--url <url>] [--project <name>]`                     | Configure or inspect the local url/project setup.                              |

Run `dokploy-axi --help` or `dokploy-axi <command> --help` for exact flags.

## Encoded traps

Behaviors that don't show up from the command names alone:

1. **`composeStatus` flickers.** It passes through `done` for a few seconds around a deploy — and right after triggering one, the status still reads the _previous_ build's `done`. So `--watch` trusts a status only once two spaced reads agree, and accepts `done`/`idle` only after it has actually seen the service `running` (a confirmed `error` is reported immediately).
2. **No zombie detection upstream.** An OOM'd build stays `running` forever, and `running` is never a terminal state for `--watch` — so every watch gives up after an explicit wall-clock timeout ("still running after Ns — check the VPS"). A timeout is not a failure verdict: check `deployments`/`logs`.
3. **`compose.update` silently ignores `appName`.** `appName` carries a random suffix Dokploy assigns — this CLI never exposes or sends it, resolving services by name only. `pin`/`unpin` send `gitlabBranch` as the sole mutated field.
4. **`logs` is build/deployment logs only.** Application runtime logs are WebSocket-only in Dokploy and out of scope for this CLI — the output labels itself as build logs so an agent doesn't mistake it for app output.
5. **OpenAPI 500 triggers an automatic tRPC fallback.** A known Dokploy bug makes the OpenAPI facade 500 on payloads the tRPC engine serves fine (dokploy#3793); the transport retries via tRPC before surfacing an error.
6. **`env` is read-only.** `saveEnvironment` replaces the whole environment block and drops `SHARED_NETWORK` — writes are refused and redirected to the Dokploy UI.
7. **`pin` suggests its `unpin`.** After pinning a branch, the CLI always surfaces the return-to-`main` command in its help block.

A raw `403` from the API means Traefik IP filtering on the target server, not a bad key — the error message says so explicitly.

## Benchmark

Tokens (`o200k_base`, via `gpt-tokenizer`) of the raw API JSON a Dokploy MCP tool would return vs `dokploy-axi` output, on four read operations, measured 2026-08-31 against a synthetic project shaped like a real Géofoncier dev instance (23 composes/applications, 10-entry deployment history) — service names, branch names, commit messages and ids are all fabricated; only the topology size and payload shape come from the real dev instance. Fixtures were generated by running the built CLI against a local mock server, so the `dokploy-axi` side reflects the real rendering code, not hand-typed output. Methodology and fixtures in `scripts/benchmark.ts` and `scripts/fixtures/`; rerun with `pnpm bench`.

| Commande     | Tokens MCP brut | Tokens dokploy-axi | Delta % | Note                                                  |
| ------------ | --------------- | ------------------ | ------- | ----------------------------------------------------- |
| home         | 1294            | 1332               | +2.9%   | raw = `project.all` (the MCP call `home` is built on) |
| service view | 4241            | 95                 | -97.8%  | raw = `compose.one`                                   |
| deployments  | 3194            | 709                | -77.8%  | raw = `deployment.allByCompose`                       |
| logs         | 661             | 702                | +6.2%   | raw = `deployment.readLogs`, tail=200                 |

Delta médian : -37.4%. `service view` saves the most: `compose.one`'s raw payload carries the full compose config (build args, source provider metadata, mount definitions, per-deployment history entries, GitLab OAuth provider details) that a status check never reads — `dokploy-axi` keeps only name, kind, status, branch, watch paths, domains, docker services and the last deployment. `home` and `logs` are near parity by design and can land on either side of zero: `home` fans out to per-service deployment lookups the single `project.all` call doesn't cover, and `logs` passes build output through close to verbatim since agents need the raw build trace to debug a failure — the small fixed banner it prepends (which deployment, which tail, the build-vs-runtime disclaimer) can outweigh the raw/rendered gap on a short log.

## License

MIT
