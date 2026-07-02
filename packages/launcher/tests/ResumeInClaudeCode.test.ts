/**
 * ResumeInClaudeCode tests — the "Resume in Claude Code" connected-menu handoff.
 *
 * Every effect (resume-info fetch / UI suspend / notice / CLI detection / the claude
 * spawn) is an injected seam, so the whole flow runs with fakes — no real api, no real
 * `claude`, no Ink. Asserts: the resumable path spawns `claude --resume <id>` in the
 * chat's cwd INSIDE the UI suspend; the not-resumable / no-CLI / error paths never
 * suspend or spawn and surface a notice.
 */
import { describe, expect, it } from 'bun:test';

import { resumeChatInClaudeCode, CLAUDE_CLI_HINT } from '../src/ResumeInClaudeCode.js';

import type { ChatSummary } from '../src/ChatsClient.js';
import type { GetChatResumeInfoResponse } from '@vgit2/shared/types';

const CHAT: ChatSummary = { id: 'chat_1', title: 'Fix the bug' };

function makeDeps(overrides: Partial<Parameters<typeof resumeChatInClaudeCode>[1]> = {}) {
  const events: string[] = [];
  const notices: Array<string | null> = [];
  const runArgs: Array<{ sessionId: string; cwd: string }> = [];
  const deps: Parameters<typeof resumeChatInClaudeCode>[1] = {
    getResumeInfo: async () =>
      ({ resumable: true, sessionId: 'sess_1', cwd: '/repo/app' }) as GetChatResumeInfoResponse,
    suspendAndRun: async (fn) => {
      events.push('suspend:start');
      await fn();
      events.push('suspend:end');
    },
    setNotice: (n) => {
      notices.push(n);
    },
    log: () => {},
    detectClaude: async () => true,
    runClaudeResume: async (sessionId, cwd) => {
      events.push('run');
      runArgs.push({ sessionId, cwd });
      return 0;
    },
    ...overrides,
  };
  return { deps, events, notices, runArgs };
}

describe('resumeChatInClaudeCode', () => {
  it('resumable + claude present → spawns `claude --resume` in the cwd, inside the UI suspend', async () => {
    const { deps, events, notices, runArgs } = makeDeps();

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toEqual({ status: 'resumed', sessionId: 'sess_1', cwd: '/repo/app', exitCode: 0 });
    // The spawn ran with the resolved session id + cwd...
    expect(runArgs).toEqual([{ sessionId: 'sess_1', cwd: '/repo/app' }]);
    // ...and it ran INSIDE suspendAndRun (UI released → run → UI restored).
    expect(events).toEqual(['suspend:start', 'run', 'suspend:end']);
    // A transient "launching" notice, then cleared once back on the menu.
    expect(notices[notices.length - 1]).toBeNull();
    expect(notices.some((n) => typeof n === 'string' && n.includes('Launching'))).toBe(true);
  });

  it('claude CLI not installed → hint notice, never suspends or spawns', async () => {
    const { deps, events, notices } = makeDeps({ detectClaude: async () => false });

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toEqual({ status: 'no-cli' });
    expect(events).toEqual([]); // no suspend, no run
    expect(notices).toContain(CLAUDE_CLI_HINT);
  });

  it('not resumable (no-session) → explains, never detects/suspends/spawns', async () => {
    const { deps, events, notices } = makeDeps({
      getResumeInfo: async () => ({ resumable: false, reason: 'no-session' }),
      detectClaude: async () => {
        throw new Error('detectClaude must not be called for a non-resumable chat');
      },
    });

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toEqual({ status: 'not-resumable', reason: 'no-session' });
    expect(events).toEqual([]);
    expect(notices.some((n) => typeof n === 'string' && /hasn't started a Claude session/.test(n!))).toBe(
      true
    );
  });

  it('not resumable (transcript-missing) → distinct notice', async () => {
    const { deps, notices } = makeDeps({
      getResumeInfo: async () => ({ resumable: false, reason: 'transcript-missing' }),
    });

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toEqual({ status: 'not-resumable', reason: 'transcript-missing' });
    expect(notices.some((n) => typeof n === 'string' && /transcript is missing/.test(n!))).toBe(true);
  });

  it('resume-info fetch fails → error notice, never suspends or spawns', async () => {
    const { deps, events, notices } = makeDeps({
      getResumeInfo: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toEqual({ status: 'error' });
    expect(events).toEqual([]);
    expect(notices.some((n) => typeof n === 'string' && /Could not check resume status/.test(n!))).toBe(
      true
    );
  });

  it('surfaces the claude exit code (non-zero) but still restores the UI', async () => {
    const { deps, events } = makeDeps({ runClaudeResume: async () => 130 });

    const outcome = await resumeChatInClaudeCode(CHAT, deps);

    expect(outcome).toMatchObject({ status: 'resumed', exitCode: 130 });
    // This test's runClaudeResume override doesn't record 'run'; the point is the UI
    // suspend still completes (suspend:end) even on a non-zero claude exit.
    expect(events).toEqual(['suspend:start', 'suspend:end']);
  });
});
