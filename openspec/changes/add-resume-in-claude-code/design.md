# Design: Resume in Claude Code

## Context
- The connected-menu chat action is already wired end-to-end EXCEPT the effect: `TerminalUi` calls
  `onResumeChat(chat)` (`TerminalUi.ts:527`) and the launcher passes a stub (`Launcher.ts:270`).
- The recent-chats list (`ChatsClient.listRecent`) returns `ChatSummary` = `{ id, title,
  repoFullName, preview, lastUpdated }` — it has **neither the `session_id` nor the working
  directory** that `claude --resume` needs. That data must come from the api.
- The launcher already runs interactive `claude` children with inherited stdio for
  `claude setup-token` via two injectable seams — `detectBinary('claude')` and `runInteractive`
  (`InteractiveCredentialLogin.ts:141-143`). The resume handoff reuses that exact pattern.
- The Ink UI is a single instance with a `stop()` (unmount) on its handle
  (`startLauncherUi` → `LauncherUiHandle`).

## Decisions

### 1. Resolve resume data server-side via a dedicated endpoint (not by widening the list)
Add `GET /api/chats/:chatId/resume-info` rather than adding `sessionId`/`cwd` to the frequently
-polled list. Rationale: the correct `cwd` is the transcript's **real** cwd, which the api already
computes with `resolveTranscriptKeys` (a chat row's `repo_path` can be the repo ROOT while the
session ran in a SUBDIR whose slug differs — resuming against the root would open an empty/other
session). The endpoint also validates the `<slug>/<session>.jsonl` exists and encodes the honest
not-resumable reasons. Fetched lazily on selection, so the 3s list poll stays cheap.

Contract:
```
GET /api/chats/:chatId/resume-info        (behind the existing JWT/device-token auth; owner-scoped)
200 → {
  resumable: boolean,
  sessionId?: string,          // present when resumable
  cwd?: string,                // absolute; the dir to run `claude --resume` in
  reason?: 'no-session' | 'transcript-missing'
}
```
`no-session` = the chat never executed (`session_id` is null). For a forked Portable chat the
`sessionId` is the FORKED session — resuming continues the Portable conversation, and (by design)
never touches the original Claude Code transcript.

### 2. The launcher owns the terminal handoff (suspend → exec → restore)
`onResumeChat` becomes an async orchestration inside `Launcher` (it already closes over `this.ui`,
`chatsWatch`, the connection watcher, and `chatsClient`):
1. Pause the chats + connection watchers (they call `ui.rerender` — must not fire while Ink is down).
2. `await chatsClient.getResumeInfo(chat.id)`; if `!resumable` → surface the reason as a menu notice
   and return (do NOT suspend the UI).
3. `detectBinary('claude')`; if absent → print the install hint (reuse the `InteractiveCredentialLogin`
   copy) and return.
4. `this.ui.stop()` to release the TTY, then `runInteractive('claude', ['--resume', sessionId],
   { cwd, stdio: 'inherit' })` — the operator drops into their real Claude Code session.
5. On exit, re-mount the UI (`startLauncherUi(..., initialPhase: 'connected')` → new `this.ui`) and
   re-arm the watchers.

Background services are separate child processes and are **left running**, so the PC stays paired /
online and heartbeating while the operator is in Claude Code.

### 3. Ink unmount → re-mount (the one nuance)
The package invariant is "ONE `render()` per session; transition via `rerender`, never a second
`render()`" — to avoid stale scrollback frames on the pairing→connected transition. A deliberate
**suspend-for-subprocess** is a distinct, legitimate flow: we WANT the fresh menu to render BELOW the
Claude Code session output after it exits. So the resume path does `ui.stop()` (full unmount) then a
new `startLauncherUi` render. This is the only subtle bit and gets an explicit ordering test.

## Risks / edge cases
- **`--debug` tees api logs to the terminal**, which would scribble over an interactive Claude session.
  Pause the terminal tee during the handoff (or, minimally, document that resume is best outside
  `--debug`). Decision: pause the tee.
- **Concurrent mobile + terminal on the same chat.** Both would append to the same session transcript.
  Fork-on-first-write guards the reverse direction only. v1 scope: document that resuming a chat in the
  terminal while it is live on mobile is unsupported; no locking.
- **`claude` CLI absent.** Portable uses the bundled Agent SDK, so the CLI may not be installed —
  handled by the `detectBinary` gate + hint (never crash, never suspend the UI).
- **Chat never executed** (`session_id` null) → `reason: 'no-session'`; the action explains instead of
  failing.

## Alternatives considered
- *Widen `/api/chats` to include `sessionId`/`repoPath`* — rejected: misses the subdir-cwd + forked
  -session resolution and bloats the poll.
- *Copy-the-command handoff (like the mobile idea)* — unnecessary here; the launcher can exec directly.
- *One-tap "open a new terminal window on the PC"* — deferred; cross-platform terminal spawning is
  fragile and the in-place handoff is strictly better UX.
