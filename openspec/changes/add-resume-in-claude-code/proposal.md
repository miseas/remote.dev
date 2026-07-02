# Change: Add "Resume in Claude Code" (launcher terminal handoff)

## Why
The launcher's connected menu already lists recent chats and offers a third chat action,
**"Resume in Claude Code"** (`packages/launcher/src/TerminalUi.ts:295`), but it is a stub: selecting
it only shows `"Resume in Claude Code — coming soon."` (`TerminalUi.ts:527-528`) and writes a log line
(`packages/launcher/src/Launcher.ts:270-273`).

Portable chats are backed by the **same** `~/.claude/projects/<slug>/<session>.jsonl` transcripts that
the terminal `claude --resume` reads, and the launcher runs on the PC that **owns the terminal**. So
this action can hand the terminal off to a live `claude --resume <sessionId>` session in the chat's
working directory — letting the operator continue a chat (started on mobile or in the terminal)
directly in Claude Code with full context, no copy-paste, no relay round-trip.

## What Changes
- **API:** add authenticated `GET /api/chats/:chatId/resume-info` → `{ resumable, sessionId?, cwd?,
  reason? }`, resolving the chat's session id + **real transcript cwd** (via the existing
  `resolveTranscriptKeys` logic) and confirming the transcript exists.
- **Launcher:** add `ChatsClient.getResumeInfo(chatId)`; expand the stubbed `onResumeChat` to detect
  the `claude` CLI, **suspend the Ink UI**, spawn `claude --resume <sessionId>` (inherited stdio, chat
  cwd), and **restore the menu** when Claude Code exits. Background services (api child, cloudflared,
  registration heartbeat, health monitor) stay running throughout.
- **UI:** replace the "coming soon" notice with the real flow and honest not-resumable reasons.

## Impact
- **New capability spec:** `resume-in-claude-code`.
- **Affected code:** `packages/api/src/routes/subroutes/chat.routes.ts` + a `ChatExecutionService` /
  `ClaudeProjects` helper; `packages/shared/src/types` (response type); `packages/launcher/src/{
  ChatsClient.ts, Launcher.ts, TerminalUi.ts}`.
- **Out of scope / unchanged:** relay, gateway, mobile app. Requires the `claude` CLI on the PC;
  the feature degrades with a clear hint when it is absent.
