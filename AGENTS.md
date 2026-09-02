# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

See `README.md` for what this project is and how to use it.

## Agent usage notes

- Auth: `DOKPLOY_API_KEY` from the environment only — never accepted or written by `setup`, never logged. Server URL and project name live in `~/.config/dokploy-axi/config.json`, written by `dokploy-axi setup --url <url> --project <name>`; `DOKPLOY_URL` overrides the URL for a one-off server.
- Resolve services by **name**, never by Dokploy's internal `appName` (random suffix) — this CLI never exposes it. `dokploy-axi service list` shows the names to use everywhere else.
- `logs` returns **build/deployment logs only** — container runtime logs are WebSocket-only in Dokploy and out of scope. Don't expect application stdout/stderr there.
- `env view` is read-only by design (`saveEnvironment` replaces the whole block and drops `SHARED_NETWORK`) — writes must go through the Dokploy UI.
- `service deploy`/`redeploy --watch` polls until two spaced reads agree on a terminal status (`done`, `error` or `idle`); `running` is never terminal, and `done`/`idle` count only once the watch has seen the service `running` — otherwise the stale pre-build `done` would read as instant success. It always gives up after a timeout — a timeout doesn't mean failure, it means check `deployments`/`logs` manually.
- `api <router.procedure>` refuses anything it classifies as a mutation without `--allow-mutation`; classification is name-based (a curated read-prefix list in `src/commands/api.ts`) and errs toward requiring the flag when unsure.
- Token accounting lives in `src/gain.ts`: `send()` in `src/dokploy.ts` is the single point every response passes through, so raw bodies are counted there once, and the tRPC fallback drops the 500 body it retried. `gpt-tokenizer` is imported dynamically after stdout is written — never move it to a static import, it would load its BPE tables on every invocation. `AXI_GAIN=0` disables the whole path.
- `pnpm build && pnpm test && pnpm lint` must all be green before considering a change done. `pnpm bench` reruns the token benchmark against the fixtures in `scripts/fixtures/`.
