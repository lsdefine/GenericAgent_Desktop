import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConductorClient } from '../services/conductor-client';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(public url: string) { Socket.instances.push(this); }
  opened() { this.readyState = 1; this.onopen?.(); }
}
let client: ConductorClient;
const status = vi.fn();
const receive = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  client = new ConductorClient(status, receive);
});
afterEach(() => { client.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('connection-only conductor client', () => {
  it('has no constructor side effects and connects idempotently', () => {
    expect(Socket.instances).toHaveLength(0);
    client.connect(); client.connect();
    expect(Socket.instances).toHaveLength(1);
    expect(Socket.instances[0].url).toBe('ws://127.0.0.1:8900/ws');
    Socket.instances[0].opened();
    expect(status).toHaveBeenLastCalledWith('ready');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retries while offline without any process-management request', () => {
    client.connect();
    for (let i = 0; i < 7; i++) {
      Socket.instances[Socket.instances.length - 1].close();
      expect(status).toHaveBeenLastCalledWith('offline');
      vi.advanceTimersByTime(30_000);
    }
    expect(Socket.instances).toHaveLength(8);
    Socket.instances[Socket.instances.length - 1].opened();
    expect(status).toHaveBeenLastCalledWith('ready');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('disconnect cancels retry and ignores stale socket events', () => {
    client.connect();
    const old = Socket.instances[0];
    const lateOpen = old.onopen!;
    const lateMessage = old.onmessage!;
    old.close(); client.disconnect();
    lateOpen(); lateMessage({ data: '{"type":"hello"}' });
    vi.advanceTimersByTime(90_000);
    expect(Socket.instances).toHaveLength(1);
    expect(receive).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith('offline');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends and receives only over the existing connection', () => {
    expect(client.send({ msg: 'hello' })).toBe(false);
    client.connect(); const socket = Socket.instances[0]; socket.opened();
    expect(client.send({ msg: 'hello' })).toBe(true);
    expect(socket.send).toHaveBeenCalledWith('{"msg":"hello"}');
    socket.onmessage!({ data: '{"type":"hello","chat":[]}' });
    expect(receive).toHaveBeenCalledWith({ type: 'hello', chat: [] });
  });
  it('task cancellation is a protocol request, not server shutdown', async () => {
    await client.cancelWorker('task/1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8900/subagent/task%2F1', expect.objectContaining({ body: '{"action":"kill"}' }));
  });
  it('can reconnect after explicit disconnect', () => {
    client.connect(); client.disconnect(); client.connect();
    expect(Socket.instances).toHaveLength(2);
    Socket.instances[1].opened();
    expect(status).toHaveBeenLastCalledWith('ready');
  });
});


describe('bridge-independent connection', () => {
  it('joins a pending direct connection without requesting startup', async () => {
    const launch = vi.fn();
    client = new ConductorClient(status, receive, launch);
    client.connect();
    await client.ensureConnected();
    expect(Socket.instances).toHaveLength(1);
    Socket.instances[0].opened();
    Socket.instances[0].onmessage!({ data: '{"type":"hello","chat":[{"msg":"history"}]}' });
    expect(status).toHaveBeenLastCalledWith('ready');
    expect(receive).toHaveBeenCalledWith({ type: 'hello', chat: [{ msg: 'history' }] });
    expect(launch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps reconnecting when optional startup fails', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('bridge unavailable'));
    client = new ConductorClient(status, receive, launch);
    await client.ensureConnected();
    Socket.instances[0].close();
    await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith('offline');
    vi.advanceTimersByTime(1200);
    Socket.instances[1].opened();
    expect(status).toHaveBeenLastCalledWith('ready');
    Socket.instances[1].close();
    vi.advanceTimersByTime(1200);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(Socket.instances).toHaveLength(3);
  });
  it('does not wait for a hung launcher to load conductor state', async () => {
    client = new ConductorClient(status, receive, () => new Promise(() => {}));
    await client.ensureConnected();
    Socket.instances[0].close();
    vi.advanceTimersByTime(1200);
    Socket.instances[1].opened();
    expect(status).toHaveBeenLastCalledWith('ready');
  });
  it('does not reconnect after disconnect during optional startup', async () => {
    let resolve!: () => void;
    client = new ConductorClient(status, receive, () => new Promise<void>((r) => { resolve = r; }));
    await client.ensureConnected();
    Socket.instances[0].close();
    client.disconnect();
    resolve(); await Promise.resolve();
    vi.advanceTimersByTime(90_000);
    expect(Socket.instances).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith('offline');
  });
});


it('launch assistance uses the bridge shared-service start endpoint', async () => {
  const { startConductorIfMissing } = await import('../services/conductor-startup');
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
  await startConductorIfMissing();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/services/start'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'frontends/conductor.py' }) }));
});
