import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useConductorStore as store } from '../stores/conductor';

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose = null;
  onerror = null;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.latest = this; }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
beforeEach(() => {
  vi.stubGlobal('WebSocket', Socket);
  store.getState().connect();
  Socket.latest.readyState = 1;
  Socket.latest.onopen?.();
});
afterEach(() => { store.getState().disconnect(); vi.unstubAllGlobals(); });

it('loads history and worker state from the real protocol handler', () => {
  Socket.latest.receive({ type: 'hello', chat: [{ id: '1', role: 'conductor', msg: 'hello' }], subagents: [{ id: 'w', status: 'stopped', reply: 'done' }], running: false });
  expect(store.getState().messages[0].msg).toBe('hello');
  expect(store.getState().workers[0].status).toBe('reported');
});
it('sends attachments, merges the user echo, then accepts the reply once', () => {
  const files = [{ name: 'a.txt', path: '/a.txt' }];
  store.getState().sendMessage('test', files);
  expect(Socket.latest.send).toHaveBeenCalledWith(JSON.stringify({ msg: 'test', files }));
  expect(store.getState().conductorTyping).toBe(true);
  Socket.latest.receive({ type: 'chat', item: { id: 'u', role: 'user', msg: 'test' } });
  expect(store.getState().messages).toHaveLength(1);
  expect(store.getState().messages[0]._local).toBe(false);
  const reply = { type: 'chat', item: { id: 'r', role: 'conductor', msg: 'answer' } };
  Socket.latest.receive(reply); Socket.latest.receive(reply);
  expect(store.getState().messages).toHaveLength(2);
  expect(store.getState().conductorTyping).toBe(false);
});
it('displays server errors and clears waiting state', () => {
  store.getState().sendMessage('test');
  Socket.latest.receive({ type: 'chat', item: { id: 'e', role: 'error', msg: 'model unavailable' } });
  expect(store.getState().messages[1].msg).toBe('model unavailable');
  expect(store.getState().conductorTyping).toBe(false);
});
it('does not pretend an offline message was sent', () => {
  store.getState().disconnect();
  store.getState().sendMessage('test');
  expect(store.getState().messages).toHaveLength(0);
  expect(Socket.latest.send).not.toHaveBeenCalled();
});


function modelHello() {
  Socket.latest.receive({ type: 'hello', llms: [[0, 'Mixin/a', true], [7, 'Native/b', false]], llm: 0 });
}
it('gets models only from hello and waits for WS confirmation', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  modelHello();
  expect(store.getState().models).toEqual([{ id: 0, name: 'Mixin/a' }, { id: 7, name: 'Native/b' }]);
  store.getState().selectModel(7);
  expect(Socket.latest.send).toHaveBeenCalledWith('{"llm":7}');
  expect(store.getState().selectedModel).toBe(0);
  expect(store.getState().pendingModel).toBe(7);
  store.getState().selectModel(0);
  expect(Socket.latest.send).toHaveBeenCalledTimes(1);
  Socket.latest.receive({ type: 'model_selected', llm: 7 });
  expect(store.getState().selectedModel).toBe(7);
  expect(store.getState().pendingModel).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('uses server value on failure and accepts selection broadcasts from other clients', () => {
  modelHello(); store.getState().selectModel(7);
  Socket.latest.receive({ type: 'model_error', llm: 0, error: 'unavailable' });
  expect(store.getState().selectedModel).toBe(0);
  expect(store.getState().pendingModel).toBeNull();
  expect(store.getState().modelError).toBe('unavailable');
  Socket.latest.receive({ type: 'model_selected', llm: 7 });
  expect(store.getState().selectedModel).toBe(7);
  expect(store.getState().modelError).toBe('');
});
it('rejects unknown IDs, same selection and offline requests', () => {
  modelHello(); store.getState().selectModel(99); store.getState().selectModel(0);
  store.getState().disconnect(); store.getState().selectModel(7);
  expect(Socket.latest.send).not.toHaveBeenCalled();
  expect(store.getState().models).toEqual([]);
});
it('clears pending on timeout without claiming a successful change', () => {
  vi.useFakeTimers();
  try {
    modelHello(); store.getState().selectModel(7); vi.advanceTimersByTime(10_000);
    expect(store.getState().selectedModel).toBe(0);
    expect(store.getState().pendingModel).toBeNull();
    expect(store.getState().modelError).toContain('超时');
    Socket.latest.receive({ type: 'model_selected', llm: 7 });
    expect(store.getState().selectedModel).toBe(7);
  } finally { vi.useRealTimers(); }
});
it('resynchronizes after disconnect instead of retaining an unconfirmed selection', () => {
  modelHello(); store.getState().selectModel(7); store.getState().disconnect();
  expect(store.getState().pendingModel).toBeNull();
  expect(store.getState().selectedModel).toBeNull();
  store.getState().connect(); Socket.latest.readyState = 1; Socket.latest.onopen?.(); modelHello();
  expect(store.getState().selectedModel).toBe(0);
  expect(store.getState().modelError).toBe('');
});
