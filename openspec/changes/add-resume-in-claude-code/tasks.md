# Tasks: Resume in Claude Code

## 1. API — resume-info endpoint
- [ ] 1.1 Add a `ChatResumeInfo` response type to `@vgit2/shared/types` (`{ resumable, sessionId?,
      cwd?, reason? }`) and export it from `types/index.ts`.
- [ ] 1.2 Add a resolver (e.g. `ChatExecutionService.getResumeInfo(chatId, userId)`) that returns the
      chat's session id + **real transcript cwd** using the existing `resolveTranscriptKeys` /
      ClaudeProjects logic, and checks the `<slug>/<session>.jsonl` exists. Map: null session →
      `no-session`; missing file → `transcript-missing`.
- [ ] 1.3 Mount `GET /api/chats/:chatId/resume-info` in `packages/api/src/routes/subroutes/chat.routes.ts`
      as a thin `requireAuth` route delegating to 1.2 (owner-scoped; return a typed response).

## 2. Launcher — fetch the resume data
- [ ] 2.1 Add `ChatsClient.getResumeInfo(chatId): Promise<ChatResumeInfo>` (same loopback base + Bearer
      pattern as `listRecent`/`archive`).

## 3. Launcher — terminal handoff
- [ ] 3.1 Expand `onResumeChat` in `Launcher.ts` into an async orchestration: pause `chatsWatch` + the
      connection watcher → `getResumeInfo` → branch on `resumable`/CLI presence → suspend UI → run
      `claude --resume` → restore UI + re-arm watchers.
- [ ] 3.2 Reuse the existing seams: `detectBinary('claude')` for the CLI gate and a `runInteractive`
      -style spawn (`stdio: 'inherit'`, `cwd`, args `['--resume', sessionId]`). Thread them as injected
      deps on `Launcher`/`createLauncher` so the flow is testable with fakes.
- [ ] 3.3 UI lifecycle: `this.ui.stop()` before the spawn; after exit, re-mount via `startLauncherUi(...,
      initialPhase: 'connected')` and reassign `this.ui`. Ensure ordering: watchers off → unmount →
      spawn → (await exit) → remount → watchers on.
- [ ] 3.4 In `--debug`, pause the api-log terminal tee for the duration of the handoff so it can't
      corrupt the interactive session; restore it after.

## 4. Launcher — UI copy
- [ ] 4.1 In `TerminalUi.ts`, remove the hardcoded `'Resume in Claude Code — coming soon.'` notice; show
      a transient "Launching Claude Code…" and let not-resumable / no-CLI reasons surface as menu notices.
      `CHAT_ACTIONS` is unchanged.

## 5. Automated tests
- [ ] 5.1 **api unit** — `getResumeInfo` / the route: resumable (repo chat), workspace/`tmp` chat, forked
      session id, `no-session`, `transcript-missing`, and the subdir-cwd resolution case.
      Run: `cd packages/api && bun test -t "resume-info"`.
- [ ] 5.2 **launcher unit** — inject fakes for `getResumeInfo`, `detectBinary`, `runInteractive`, and the
      UI handle; assert: (a) resumable+CLI → `runInteractive` called with `['--resume', <sessionId>]` and
      the resolved `cwd`, UI stopped before and re-mounted after; (b) missing CLI → hint shown, no spawn,
      no UI stop; (c) `no-session` → notice, no spawn; (d) watcher stop→restart ordering.
      Run: `cd packages/launcher && bun test`.
- [ ] 5.3 `bun typecheck` green (api + launcher + shared).

## 6. Manual verification (host machine) — the runbook
> Prereqs: the `claude` CLI installed on the PC; at least one recent Portable chat that has run at least
> once; and a chat that has NEVER run (for the no-session path). Run from source: `bun run portable`.

- [ ] 6.1 `bun run portable` → pair (or reuse a pairing) so the **connected menu** shows. Arrow to
      **Recent chats**, select a chat that has run → choose action 3 **Resume in Claude Code**.
      **Expect:** the menu disappears and an interactive `claude --resume` session opens **in the chat's
      repo directory** with the prior conversation loaded. → satisfies *"Resumable chat launches Claude
      Code and restores the menu"*.
- [ ] 6.2 In a second terminal during 6.1, `curl -s https://app.portable.dev/t/<pcId>/api/health` (or the
      loopback `/api/health`) returns `{status:"ok"}`, and the tunnel is still registered. → *"Background
      services stay up during the handoff"*.
- [ ] 6.3 Exit Claude Code (Ctrl-D / `/exit`). **Expect:** the connected menu re-renders below the session
      output and the recent-chats list is live again (archive/refresh still work). → *"restores the menu"*
      + *"watchers resume"*.
- [ ] 6.4 Select **Resume in Claude Code** on a chat that has never run. **Expect:** a "hasn't started a
      Claude session yet" notice, menu stays put, nothing spawns. → *"Chat is not resumable"*.
- [ ] 6.5 Temporarily make `claude` unresolvable (e.g. `PATH=` for the run) and select the action.
      **Expect:** an install hint, menu stays put, no spawn. → *"`claude` CLI not installed"*.
- [ ] 6.6 Confirm the string "coming soon" no longer appears for this action. → *"placeholder removed"*.
- [ ] 6.7 Repeat 6.1 under `bun run portable -- --debug` and confirm streamed api logs do not corrupt the
      Claude Code session. → design risk (`--debug` tee).

## 7. Docs
- [ ] 7.1 Note the new endpoint + the resume flow in `packages/api/CLAUDE.md` (chat routes) and
      `packages/launcher/CLAUDE.md` (connected menu / chat actions).

## Acceptance criteria (all must pass)
- [ ] Every scenario in `specs/resume-in-claude-code/spec.md` is satisfied by an automated test (§5)
      **or** a manual runbook step (§6), as annotated above.
- [ ] `bun typecheck` and both `bun test` suites (api, launcher) are green.
- [ ] The manual runbook (§6.1–6.7) passes on a real host with the `claude` CLI installed.
- [ ] No relay/gateway/mobile changes; background services remain up throughout a resume.
