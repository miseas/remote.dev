import { spawn } from 'child_process';

import type { ChatSummary } from './ChatsClient.js';
import type { GetChatResumeInfoResponse } from '@vgit2/shared/types';

/**
 * "Resume in Claude Code" — the connected-menu chat action that hands the terminal to a
 * live `claude --resume <sessionId>` session on the host machine.
 *
 * The launcher runs on the PC that owns the terminal AND Portable chats are backed by the
 * same `~/.claude/projects/<slug>/<session>.jsonl` transcripts the terminal `claude`
 * reads, so resuming is a direct hand-off: fetch the session id + real cwd from the api
 * (`GET /api/chats/:id/resume-info`), suspend the Ink UI, and spawn `claude --resume` with
 * inherited stdio in that cwd. Background services (api child, cloudflared, registration,
 * health monitor) keep running — only the UI yields the terminal.
 *
 * Every effect (resume-info fetch / UI suspend / notice / CLI detection / spawn) is an
 * injected seam so the flow is unit-testable with no real api, `claude`, or Ink.
 */

/** Detect whether the `claude` CLI is on PATH (resolves false on ENOENT / error). */
export type DetectClaudeImpl = () => Promise<boolean>;

/**
 * Run `claude --resume <sessionId>` in `cwd` with INHERITED stdio (the operator drives
 * Claude Code in the same terminal). Resolves the exit code (null on spawn error). Never throws.
 */
export type RunClaudeResumeImpl = (sessionId: string, cwd: string) => Promise<number | null>;

/** Default `claude` detection — `claude --version`, false on any failure. */
export const realDetectClaude: DetectClaudeImpl = () =>
  new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn('claude', ['--version'], { stdio: 'ignore' });
      child.once('error', () => done(false));
      child.once('exit', (code) => done(code === 0));
    } catch {
      done(false);
    }
  });

/** Default resume spawn — `claude --resume <sessionId>` in `cwd`, inherited stdio. */
export const realRunClaudeResume: RunClaudeResumeImpl = (sessionId, cwd) =>
  new Promise((resolve) => {
    try {
      const child = spawn('claude', ['--resume', sessionId], { stdio: 'inherit', cwd });
      child.once('error', () => resolve(null));
      child.once('exit', (code) => resolve(code ?? null));
    } catch {
      resolve(null);
    }
  });

/** Shown when the `claude` CLI isn't installed (resume needs the desktop CLI). */
export const CLAUDE_CLI_HINT =
  'Claude Code CLI not found — install it (https://claude.com/claude-code) to resume here.';

export interface ResumeInClaudeCodeDeps {
  /** Fetch resume-info from the loopback api (`ChatsClient.getResumeInfo`). */
  getResumeInfo: (chatId: string) => Promise<GetChatResumeInfoResponse>;
  /** Suspend the Ink UI, run the interactive child, then re-mount (`LauncherUiHandle.suspendAndRun`). */
  suspendAndRun: (fn: () => Promise<void>) => Promise<void>;
  /** Show (or clear) a transient notice on the connected menu (`LauncherUiHandle.setNotice`). */
  setNotice: (notice: string | null) => void;
  /** File-sink log (NEVER the Ink-owned terminal). */
  log: (line: string) => void;
  /** CLI-detection seam (default: {@link realDetectClaude}). */
  detectClaude?: DetectClaudeImpl;
  /** Resume-spawn seam (default: {@link realRunClaudeResume}). */
  runClaudeResume?: RunClaudeResumeImpl;
}

/** The outcome, returned for tests/telemetry (the UI reacts via `setNotice`). */
export type ResumeOutcome =
  | { status: 'resumed'; sessionId: string; cwd: string; exitCode: number | null }
  | { status: 'not-resumable'; reason?: GetChatResumeInfoResponse['reason'] }
  | { status: 'no-cli' }
  | { status: 'error' };

/**
 * Drive "Resume in Claude Code" for a chat. Gates on resumability + the `claude` CLI, then
 * hands the terminal to `claude --resume`. Never throws — every failure resolves to an
 * outcome AND a user-facing notice. Does NOT suspend the UI unless it will actually spawn.
 */
export async function resumeChatInClaudeCode(
  chat: ChatSummary,
  deps: ResumeInClaudeCodeDeps
): Promise<ResumeOutcome> {
  const detect = deps.detectClaude ?? realDetectClaude;
  const run = deps.runClaudeResume ?? realRunClaudeResume;

  let info: GetChatResumeInfoResponse;
  try {
    info = await deps.getResumeInfo(chat.id);
  } catch (err) {
    deps.log(
      `[chats] resume-info failed for ${chat.id}: ${err instanceof Error ? err.message : String(err)}`
    );
    deps.setNotice('Could not check resume status — is the runtime still up? Try again.');
    return { status: 'error' };
  }

  if (!info.resumable) {
    const msg =
      info.reason === 'no-session'
        ? "This chat hasn't started a Claude session yet — send it a message first."
        : info.reason === 'transcript-missing'
          ? "This chat's Claude Code transcript is missing — it can't be resumed."
          : "This chat can't be resumed in Claude Code.";
    deps.setNotice(msg);
    return { status: 'not-resumable', reason: info.reason };
  }

  if (!(await detect())) {
    deps.setNotice(CLAUDE_CLI_HINT);
    return { status: 'no-cli' };
  }

  // Resumable + CLI present → hand off the terminal.
  const sessionId = info.sessionId as string;
  const cwd = info.cwd as string;
  deps.log(`[chats] resuming ${chat.id} in Claude Code (session ${sessionId}) at ${cwd}`);
  deps.setNotice(`Launching Claude Code for "${chat.title}"…`);

  let exitCode: number | null = null;
  await deps.suspendAndRun(async () => {
    exitCode = await run(sessionId, cwd);
  });

  // Back on the menu — clear the transient notice.
  deps.setNotice(null);
  deps.log(`[chats] Claude Code session for ${chat.id} exited (code ${exitCode ?? 'null'})`);
  return { status: 'resumed', sessionId, cwd, exitCode };
}
