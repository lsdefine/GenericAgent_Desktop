import { CONDUCTOR_BASE, CONDUCTOR_WS_URL } from './constants';

export type ConductorConnectionStatus = 'connecting' | 'ready' | 'offline' | 'error';

/** Connection only. The conductor server has its own lifecycle, independent of desktop. */
export class ConductorClient {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private startupAllowed = false;
  private generation = 0;

  constructor(
    private readonly status: (status: ConductorConnectionStatus) => void,
    private readonly receive: (data: Record<string, unknown>) => void,
    private readonly startIfMissing?: () => Promise<void>,
  ) {}

  connect = () => {
    this.failures = 0;
    this.open();
  };

  /** Connect directly. Startup is optional assistance only after connection failure. */
  ensureConnected = (): Promise<void> => {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.startupAllowed = true;
    this.connect();
    return Promise.resolve();
  };

  private tryStartup() {
    if (!this.startupAllowed || !this.startIfMissing) return;
    this.startupAllowed = false;
    const generation = this.generation;
    void this.startIfMissing().then(() => {
      if (generation === this.generation) this.connect();
    }).catch(() => {
      // The independent WebSocket retry continues even if the launcher is absent.
    });
  }

  private open() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.clearRetry();
    this.status('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(CONDUCTOR_WS_URL);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.failures = 0;
      this.startupAllowed = false;
      this.status('ready');
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try { this.receive(JSON.parse(event.data)); } catch {}
    };
    socket.onerror = () => {}; // close handles retries
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.status('offline');
    const delay = Math.min(30_000, 1200 * 2 ** Math.min(this.failures++, 5));
    this.clearRetry();
    this.retry = setTimeout(() => this.open(), delay);
    this.tryStartup();
  }

  private clearRetry() {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }

  disconnect = () => {
    this.generation++;
    this.startupAllowed = false;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
    }
    this.failures = 0;
    this.status('offline');
  };

  send(payload: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  async cancelWorker(id: string): Promise<void> {
    // A protocol request to the conductor, not local process management.
    const response = await fetch(`${CONDUCTOR_BASE}/subagent/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kill' }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
}
