// @vitest-environment happy-dom
import { vi, it, expect, beforeEach, afterEach } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());
vi.mock('../services/chat', () => ({
  createSession: vi.fn(), sendPrompt: vi.fn(), pollMessages: vi.fn(),
  cancelGeneration: vi.fn(), listSessions: vi.fn(async () => []), deleteSession: vi.fn(),
  renameSession: vi.fn(), pinSession: vi.fn(), setSessionModel: vi.fn(), restoreSession: vi.fn(),
}));
vi.mock('../services/ws', () => ({
  subscribe: vi.fn((name, handler) => handlers.set(name, handler)), onBridgeStatusChange: vi.fn(),
}));
import { useChatStore } from '../stores/chat';
import * as api from '../services/chat';
const state = useChatStore.getState;
const emit = (status: string) => handlers.get('session-state')!({ sessionId: 'a', status });
const result = (status: 'idle' | 'running'): api.PollResult => ({ messages: [], status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(r => { resolve = r; }), resolve };
}
beforeEach(() => {
  state().setActiveSession(null);
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  useChatStore.setState({ activeSessionId: 'a', status: 'idle', runningSessions: new Set(), messages: [] });
  vi.mocked(api.pollMessages).mockResolvedValue(result('idle'));
});
afterEach(() => { vi.useRealTimers(); state().setActiveSession(null); });

it('late running poll cannot resurrect a stopped turn', async () => {
  const old = deferred<api.PollResult>();
  vi.mocked(api.pollMessages).mockReturnValueOnce(old.promise);
  emit('running');
  await vi.advanceTimersByTimeAsync(1000);
  emit('idle');
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(result('running'));
  await vi.advanceTimersByTimeAsync(0);
  expect(state().status).toBe('idle');
  expect(state().turnStartedAt).toBeNull();
  expect(state().runningSessions.has('a')).toBe(false);
});

it('fallback polling clears the sidebar when the stop event was lost', async () => {
  emit('running');
  await vi.advanceTimersByTimeAsync(1000);
  expect(state().status).toBe('idle');
  expect(state().runningSessions.has('a')).toBe(false);
});

it('slow polling never overlaps within a turn', async () => {
  const pending = deferred<api.PollResult>();
  vi.mocked(api.pollMessages).mockReturnValue(pending.promise);
  emit('running');
  await vi.advanceTimersByTimeAsync(4000);
  expect(api.pollMessages).toHaveBeenCalledTimes(1);
  pending.resolve(result('idle'));
  await vi.advanceTimersByTimeAsync(0);
});

it('a poll from a previous turn cannot stop a newly started turn', async () => {
  const old = deferred<api.PollResult>();
  vi.mocked(api.pollMessages).mockReturnValueOnce(old.promise);
  emit('running');
  await vi.advanceTimersByTimeAsync(1000);
  emit('idle');
  emit('running');
  old.resolve(result('idle'));
  await vi.advanceTimersByTimeAsync(0);
  expect(state().status).toBe('running');
  expect(state().runningSessions.has('a')).toBe(true);
});

it('a stale poll is ignored even after switching away and back to the same session', async () => {
  const old = deferred<api.PollResult>();
  vi.mocked(api.pollMessages).mockReturnValueOnce(old.promise);
  emit('running');
  await vi.advanceTimersByTimeAsync(1000);
  state().setActiveSession(null);
  state().setActiveSession('a');
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(result('running'));
  await vi.advanceTimersByTimeAsync(0);
  expect(state().status).toBe('idle');
});

it('polling retries after transient errors and still clears running state', async () => {
  vi.mocked(api.pollMessages).mockRejectedValueOnce(new Error('offline'));
  emit('running');
  await vi.advanceTimersByTimeAsync(1000);
  expect(state().status).toBe('running');
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.pollMessages).toHaveBeenCalledTimes(2);
  expect(state().status).toBe('idle');
  expect(state().runningSessions.has('a')).toBe(false);
});
