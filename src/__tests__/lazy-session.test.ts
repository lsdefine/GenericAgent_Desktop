// @vitest-environment happy-dom
import { vi, it, expect, beforeEach } from 'vitest';
vi.mock('../services/chat', () => ({
  createSession: vi.fn(), sendPrompt: vi.fn(), pollMessages: vi.fn(),
  cancelGeneration: vi.fn(), listSessions: vi.fn(async () => []), deleteSession: vi.fn(),
  renameSession: vi.fn(), pinSession: vi.fn(), setSessionModel: vi.fn(), restoreSession: vi.fn(),
}));
vi.mock('../services/ws', () => ({ subscribe: vi.fn(), onBridgeStatusChange: vi.fn() }));
vi.mock('../stores/notifications', () => ({ useNotificationStore: { getState: () => ({ notify: vi.fn() }) } }));
import { useChatStore } from '../stores/chat';
import * as api from '../services/chat';
beforeEach(() => {
  useChatStore.getState().setActiveSession(null);
  vi.clearAllMocks();
  vi.mocked(api.listSessions).mockResolvedValue([{ id: 'a', loaded: false } as any]);
  useChatStore.setState({ sessions: [{ id: 'a', loaded: false } as any] });
  vi.mocked(api.pollMessages).mockResolvedValue({ messages: [{ id: '1', role: 'user', content: 'history', status: 'completed' }], status: 'idle' });
});
it('list refresh does not instantiate historical sessions', async () => {
  await useChatStore.getState().loadSessions();
  expect(api.restoreSession).not.toHaveBeenCalled();
  expect(useChatStore.getState().activeSessionId).toBeNull();
});
it('click waits for restoration and blocks sending until history arrives', async () => {
  let release!: () => void;
  vi.mocked(api.restoreSession).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  useChatStore.getState().setActiveSession('a');
  expect(useChatStore.getState().loadingSession).toBe(true);
  expect(await useChatStore.getState().sendMessage('not yet')).toBe(false);
  expect(api.sendPrompt).not.toHaveBeenCalled();
  expect(api.pollMessages).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(useChatStore.getState().loadingSession).toBe(false));
  expect(useChatStore.getState().messages[0].content).toBe('history');
});
it('bridge restart clears active unloaded view without reactivating it', async () => {
  useChatStore.setState({ activeSessionId: 'a', loadingSession: false });
  await useChatStore.getState().loadSessions();
  expect(useChatStore.getState().activeSessionId).toBeNull();
  expect(api.restoreSession).not.toHaveBeenCalled();
});

it('normal session switching never requests history restoration', async () => {
  useChatStore.setState({ sessions: [{ id: 'a', loaded: true } as any] });
  vi.mocked(api.listSessions).mockResolvedValue([{ id: 'a', loaded: true } as any]);
  useChatStore.getState().setActiveSession('a');
  await vi.waitFor(() => expect(useChatStore.getState().loadingSession).toBe(false));
  expect(api.restoreSession).not.toHaveBeenCalled();
  expect(api.pollMessages).toHaveBeenCalledWith('a');
  expect(useChatStore.getState().activeSessionId).toBe('a');
});
it('list refresh during first prompt keeps the new session selected', async () => {
  vi.mocked(api.createSession).mockResolvedValue('new');
  vi.mocked(api.listSessions).mockResolvedValue([{ id: 'new', loaded: true } as any]);
  let release!: () => void;
  vi.mocked(api.sendPrompt).mockImplementation(() => new Promise<string>(resolve => { release = () => resolve('new'); }));
  const sending = useChatStore.getState().sendMessage('hello');
  await vi.waitFor(() => expect(api.sendPrompt).toHaveBeenCalled());
  await useChatStore.getState().loadSessions();
  expect(useChatStore.getState().activeSessionId).toBe('new');
  expect(useChatStore.getState().sessions[0].loaded).toBe(true);
  expect(api.restoreSession).not.toHaveBeenCalled();
  release();
  expect(await sending).toBe(true);
  expect(useChatStore.getState().activeSessionId).toBe('new');
  useChatStore.getState().setActiveSession(null);
});
