# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Portable** is a local-first Claude Code runtime. The backend (`packages/api`) runs on the
user's OWN PC bound to `127.0.0.1`; the launcher (`packages/launcher`, `portable start`)
publishes it through a Cloudflare Quick Tunnel and registers the rotating URL with a hosted
**relay**; the **Portable mobile app** (`packages/mobile`, Expo/React Native) is the only client
and pairs via a terminal QR. AI calls go **direct** to `api.anthropic.com` with the user's own
Claude credential — the relay never holds the credential, the data, or the auth token.

Bun monorepo. Full product overview + the how-it-works diagram: [`README.md`](./README.md).

## Packages (`packages/*`)

Each package has its own `CLAUDE.md` with the deep rules — **read the relevant one before working in it**:

- **`shared` (`@vgit2/shared`)** — types, `jwt` (mint/verify the data-path token), the AES-256-GCM
  `LocalSecretStore`, the Socket.IO wire protocol (`socket`), `models`/`permissions`. Consumed via
  `workspace:*` and **subpath exports** — a new subpath MUST be added to the `exports` map in
  `packages/shared/package.json`, and RN must import framework-free submodules (never the bare
  entry — it loads `dotenv`).
- **`api` (`@vgit2/api`)** — the PC backend. **API + Socket.IO only, serves no web bundle.** Local
  SQLite (`bun:sqlite`), Claude Agent SDK, MCP tools, GitHub/Google/Slack connections. Runs on Bun.
- **`launcher` (`@vgit2/launcher`)** — `portable start`. Resolves credentials → spawns the api child
  → owns cloudflared → mints the data-path JWT → renders the pairing QR (Ink terminal UI). Also the
  `portable link`/`unlink` project commands.
- **`mobile`** — the Expo/RN client (Clerk sign-in, scan QR, chat, repos, runtime).

WARNING: **The gateway/relay is NOT in this repo** — it is the external hosted service (`app.portable.dev`).
The per-package docs reference `packages/gateway` / `@vgit2/gateway`; that package does not exist
in this OSS checkout. Don't go looking for it.

## Commands

```bash
bun install                       # Bun monorepo — deps are NOT pre-installed in a fresh checkout
bun run portable                  # run the whole thing (= bun --cwd packages/launcher start) -> pairing QR
bun run portable -- --debug       # same, streaming api logs to the terminal (the -- forwards the flag)
bun --cwd packages/api dev        # run the api standalone (loads root .env)
bun run smoke:launcher            # boot the api child + assert /api/health -> {status:'ok'}
bun typecheck                     # tsc --noEmit across api + launcher + mobile
bun run format                    # prettier --write (repo-wide); format:check for CI
```

- **Lint** is per-package: `bun --cwd packages/api lint` (eslint), `bun --cwd packages/mobile lint`
  (`expo lint`). There is no root `lint` script.
- **`portable link`/`unlink`** act on the **current directory** (no path arg) and nudge a running
  api to rescan — no restart.

### Tests (no root aggregate — always `cd` into the package)

A bare `bun test` at the repo root breaks (it tries to parse mobile's RN sources); the `bunfig.toml`
`ignore`/`test:all`/`scripts/test-shard.sh` references are stale and not present here. Run per package:

```bash
cd packages/api && bun test                    # all api tests (fetch to external hosts is blocked by a preload)
cd packages/api && bun run test:unit           # or test:integration
cd packages/api && bun test tests/integration/foo.test.ts   # single file
cd packages/api && bun test -t "test name"     # single case by name
cd packages/launcher && bun test               # fully mocked — no real network/cloudflared/Ink
cd packages/mobile && bun run test             # jest-expo (NOT `bun test`, which runs Bun's runner)
```

Mobile also has a bundler-only gate `tsc`/Jest miss: run **`bunx expo export`** before declaring a
`@vgit2/shared`-import or reanimated change done (see `packages/mobile/CLAUDE.md`).

### Build / distribute the CLI

`bun run build:portable` bundles `dist-portable/{cli.js,server.js}`. `scripts/install-portable.sh`
(run from a checkout) builds + packs + `bun install -g`s it as `@volter-ai/portable.dev` — run
`bun install` first or the build fails.

## Architecture — the cross-package big picture

- **No cloud login on the PC.** The launcher mints the data-path JWT with a per-install `JWT_SECRET`
  (persisted in the shared `LocalSecretStore`) and forwards it to the api child via
  `buildApiChildEnv`; the api validates it **locally** with the SAME secret (`@vgit2/shared/jwt`).
  The relay only reverse-proxies `/t/<pcId>/*` — it never sees the secret or the JWT.
- **Two locally-validated credentials, no remote auth service:** the PC-minted **JWT** and opaque
  **device tokens** (`DeviceTokenService`; a 2-dot-part token vs a 3-part JWT is how the middleware
  routes them).
- **AI is always direct.** `LocalAiCredentialsService` resolves the user's own Claude OAuth token or
  `ANTHROPIC_API_KEY`; calls hit `https://api.anthropic.com`. `determineApiRoutingMode()` always
  returns `'direct'` — there is no billing/routing proxy. Don't reintroduce one.
- **Data is local.** Everything persists in `bun:sqlite` under `DATA_DIR`/`WORKSPACE_DIR`. Chats
  default-source from the shared `~/.claude/projects/*.jsonl` transcripts (so terminal `claude` and
  Portable share chats), with **fork-on-first-write** so Portable never clobbers a terminal session.
- **Mobile routing:** every `/api/*` + the Socket.IO handshake go to the per-PC relay
  `<gatewayBase>/t/<pcId>`; only Clerk sign-in + PC discovery use the fixed gateway.

## Cross-cutting gotchas (span packages / non-obvious)

- **PC and phone must be on the SAME relay environment — the #1 pairing-failure cause.** The
  launcher default relay is prod `https://app.portable.dev` (`--dev` -> staging
  `app.portable-dev.com`; `PORTABLE_RELAY_URL` overrides). The mobile app derives its relay from
  **its own** gateway (`getGatewayUrl()` — prod by default, dev via 10 taps on the sign-in header),
  **NOT** the QR's `gatewayBase`. Mismatched envs -> the gateway returns `pc_not_found` and the phone
  never connects, even though the PC side is healthy. The published CLI is `@volter-ai/portable.dev`;
  a stale global install can lag the source default (pre-`3.2.1` defaulted to staging).
- **Never use port `7878`** (reserved by dev tooling); default `VGIT_PORT` is `4200`.
- **Don't override `HOME` or set `CLAUDE_CONFIG_DIR`** (the "D30 invariant"): the api child inherits
  the user's real `~/.claude`, which is what makes their skills/agents/transcripts visible. The api
  must bind loopback via `API_BIND_HOST` (set by `buildApiChildEnv`).
- **`bun:sqlite` `.get()` returns `null` (not `undefined`)** for no row — use `!= null`.
- **Version lockstep:** the root and all packages share one version (currently `3.2.1`).
- **Config:** the happy path needs **no `.env`**. Knobs (`PORTABLE_RELAY_URL`, `VGIT_PORT`,
  `WORKSPACE_DIR` ~= `~/claude-workspace`, `DATA_DIR` ~= `~/.portable`, `JWT_SECRET`, `PORTABLE_PC_ID`)
  are documented in [`.env.example`](./.env.example).
- **Running the api standalone** (`bun --cwd packages/api dev`) fails the required-MCP gate unless a
  Chromium is present — `playwright install chromium` + set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
  (the launcher provisions this automatically).
