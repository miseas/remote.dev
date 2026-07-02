# Capability: resume-in-claude-code

Resume a Portable chat as a live terminal Claude Code session on the host machine, from the launcher's
connected-menu chat actions.

## ADDED Requirements

### Requirement: Chat resume-info endpoint
The API SHALL expose an authenticated `GET /api/chats/:chatId/resume-info` that reports whether a chat
can be resumed in terminal Claude Code and, when it can, the session id and the working directory to
run `claude --resume` in. The endpoint SHALL be owner-scoped like the other `/api/chats/:chatId/*`
routes and SHALL never expose another user's chat.

#### Scenario: Chat with an existing session is resumable
- **WHEN** a chat that has executed at least once (its transcript session id is known) is requested
- **THEN** the response is `{ resumable: true, sessionId, cwd }`
- **AND** `cwd` is the transcript's real working directory (the directory whose slug contains
  `<sessionId>.jsonl`), not merely the chat row's `repo_path`

#### Scenario: Chat that never started a session is not resumable
- **WHEN** a chat whose `session_id` is null (never executed) is requested
- **THEN** the response is `{ resumable: false, reason: 'no-session' }`

#### Scenario: Missing transcript is not resumable
- **WHEN** the chat has a session id but no `<slug>/<session>.jsonl` file exists on disk
- **THEN** the response is `{ resumable: false, reason: 'transcript-missing' }`

#### Scenario: A forked Portable chat resumes its own (forked) session
- **WHEN** the chat was forked-on-first-write from an original Claude Code session
- **THEN** the returned `sessionId` is the forked session id (so resuming continues the Portable
  conversation and never targets the original transcript)

#### Scenario: Unauthenticated request is rejected
- **WHEN** the request carries no valid JWT / device token
- **THEN** the endpoint responds 401/403 and returns no chat data

### Requirement: Launcher resume action hands the terminal to Claude Code
When the operator selects "Resume in Claude Code" for a recent chat in the connected menu, the launcher
SHALL, for a resumable chat with the `claude` CLI available, suspend its terminal UI and launch
`claude --resume <sessionId>` in the chat's working directory with inherited stdio, then restore the
connected menu when Claude Code exits.

#### Scenario: Resumable chat launches Claude Code and restores the menu
- **WHEN** the operator selects "Resume in Claude Code" for a resumable chat and the `claude` CLI is present
- **THEN** the launcher unmounts the Ink UI, spawns `claude --resume <sessionId>` with the resolved
  `cwd` and inherited stdio
- **AND** when that process exits, the launcher re-mounts the connected menu

#### Scenario: Background services stay up during the handoff
- **WHEN** the operator is inside the resumed Claude Code session
- **THEN** the api child, cloudflared tunnel, tunnel registration/heartbeat, and health monitor remain
  running (the PC stays paired and reachable)

#### Scenario: Watchers are paused during the handoff and resumed after
- **WHEN** the UI is suspended for the handoff
- **THEN** the chats-list and connection watchers do not render to the terminal while Claude Code owns it
- **AND** they resume polling after the menu is restored

### Requirement: Resume action fails gracefully without side effects
The launcher SHALL NOT suspend its UI or spawn a process when a resume cannot proceed, and SHALL tell
the operator why.

#### Scenario: `claude` CLI not installed
- **WHEN** the operator selects the action but the `claude` binary is not on the host
- **THEN** the launcher shows an install hint and stays on the connected menu (no UI suspend, no spawn)

#### Scenario: Chat is not resumable
- **WHEN** `resume-info` returns `resumable: false` (e.g. `no-session`)
- **THEN** the launcher shows a reason-specific notice on the menu and does not suspend the UI

#### Scenario: The "coming soon" placeholder is removed
- **WHEN** the action is selected
- **THEN** the launcher no longer shows "Resume in Claude Code — coming soon."
