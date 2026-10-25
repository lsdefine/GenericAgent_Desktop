import { create } from 'zustand';
import { startConductorIfMissing } from '../services/conductor-startup';
import { ConductorClient, type ConductorConnectionStatus } from '../services/conductor-client';

export type { ConductorConnectionStatus } from '../services/conductor-client';
export type WorkerStatus = 'running' | 'reported' | 'paused' | 'failed' | 'terminated';

export interface ConductorMessage {
  id?: string;
  role: 'user' | 'conductor' | 'system' | 'error';
  msg: string;
  ts?: number;
  read?: boolean;
  files?: { name: string; path: string }[];
  images?: { name: string; path: string; base64?: string }[];
  _local?: boolean;
}

export interface Worker {
  id: string;
  title: string;
  status: WorkerStatus;
  summary: string;
  fullReply: string;
  updatedAt?: number;
}

export interface ConductorModel {
  id: number;
  name: string;
}

interface ConductorState {
  models: ConductorModel[];
  selectedModel: number | null;
  pendingModel: number | null;
  modelError: string;
  selectModel: (id: number) => void;
  connectionStatus: ConductorConnectionStatus;
  connectionError: string;
  ensureConnected: () => Promise<void>;
  messages: ConductorMessage[];
  workers: Worker[];
  conductorTyping: boolean;

  connect: () => void;
  disconnect: () => void;
  sendMessage: (msg: string, files?: ConductorMessage['files'], images?: ConductorMessage['images']) => void;
  killWorker: (id: string) => Promise<void>;
}

function mapStatus(status: string, reply: string): WorkerStatus {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'aborted') return 'terminated';
  if (status === 'stopped') return reply.trim() ? 'reported' : 'paused';
  return 'paused';
}

let titleSeq = 0;
const titleSeen = new Map<string, number>();

function normalizeWorker(raw: Record<string, unknown>): Worker {
  const id = String(raw.id ?? '');
  if (!titleSeen.has(id)) titleSeen.set(id, ++titleSeq);

  const status = mapStatus(String(raw.status ?? ''), String(raw.reply ?? ''));
  let title = String(raw.prompt ?? '').replace(/^[\s请帮我麻烦]+/u, '').trim();
  if (!title) {
    title = `Task #${titleSeen.get(id)}`;
  } else {
    title = (title.split(/[\n。！？.!?]/)[0] || '').trim();
    if (title.length > 18) title = title.slice(0, 18) + '…';
  }

  const reply = String(raw.reply ?? '').replace(/\s+/g, ' ').trim();
  const summary = reply
    ? (reply.length > 80 ? reply.slice(0, 80) + '…' : reply)
    : (status === 'running' ? 'Working…' : 'Waiting…');

  return { id, title, status, summary, fullReply: String(raw.reply ?? ''), updatedAt: raw.updated_at as number | undefined };
}

export const useConductorStore = create<ConductorState>((set, get) => {
  let modelTimer: ReturnType<typeof setTimeout> | undefined;
  function clearModelTimer() {
    clearTimeout(modelTimer);
    modelTimer = undefined;
  }
  const client = new ConductorClient(
    (connectionStatus) => {
      if (connectionStatus !== 'ready') {
        clearModelTimer();
        set((s) => ({ models: [], selectedModel: null, pendingModel: null,
          modelError: s.pendingModel !== null ? '连接中断，模型选择结果待重新同步' : s.modelError }));
      }
      set({ connectionStatus, ...(connectionStatus === 'ready' ? { connectionError: '' } : {}) });
    },
    onMessage,
    startConductorIfMissing,
  );

  function onMessage(data: Record<string, unknown>) {

    if (data.type === 'model_selected') {
      // Broadcasts can also originate from the conductor's other clients.
      const selectedModel = data.llm as number;
      const confirmed = get().pendingModel === selectedModel;
      if (confirmed) clearModelTimer();
      set({ selectedModel, ...(confirmed || get().pendingModel === null
        ? { pendingModel: null, modelError: '' } : {}) });
    } else if (data.type === 'model_error') {
      clearModelTimer();
      set({ selectedModel: data.llm as number, pendingModel: null, modelError: String(data.error) });
    } else if (data.type === 'hello') {
      clearModelTimer();
      set({
        models: ((data.llms || []) as [number, string, boolean][]).map(([id, name]) => ({ id, name })),
        selectedModel: typeof data.llm === 'number' ? data.llm : null,
        pendingModel: null, modelError: '',
      });
      const chat = (data.chat as Record<string, unknown>[] || []).map((raw): ConductorMessage => ({
        id: String(raw.id ?? ''),
        role: (raw.role as ConductorMessage['role']) || 'system',
        msg: String(raw.msg ?? ''),
        ts: raw.ts as number | undefined,
        read: raw.read as boolean | undefined,
        files: (raw.files as ConductorMessage['files']) || [],
        images: (raw.images as ConductorMessage['images']) || [],
      }));
      const workers = ((data.subagents as Record<string, unknown>[]) || []).map(normalizeWorker);
      set({ messages: chat, workers, conductorTyping: !!data.running });
    } else if (data.type === 'subagents') {
      const workers = ((data.items as Record<string, unknown>[]) || []).map(normalizeWorker);
      set({ workers });
    } else if (data.type === 'chat') {
      const item = data.item as Record<string, unknown>;
      const newMsg: ConductorMessage = {
        id: String(item.id ?? ''),
        role: (item.role as ConductorMessage['role']) || 'system',
        msg: String(item.msg ?? ''),
        ts: item.ts as number | undefined,
        read: item.read as boolean | undefined,
        files: (item.files as ConductorMessage['files']) || [],
        images: (item.images as ConductorMessage['images']) || [],
      };
      set((s) => {
        if (newMsg.id && s.messages.some((m) => m.id === newMsg.id)) return s;
        if (newMsg.role === 'user') {
          const plain = newMsg.msg.replace(/\[(Image|File)\s+#\d+\]\s*/g, '').trim();
          for (let i = s.messages.length - 1; i >= 0; i--) {
            const m = s.messages[i];
            if (m._local && m.role === 'user') {
              const localPlain = m.msg.replace(/\[(Image|File)\s+#\d+\]\s*/g, '').trim();
              if (localPlain === plain || m.msg === newMsg.msg) {
                const updated = [...s.messages];
                updated[i] = { ...updated[i], id: newMsg.id || updated[i].id, ts: newMsg.ts ?? updated[i].ts, _local: false };
                return { messages: updated };
              }
            }
          }
        }
        const conductorTyping = (newMsg.role === 'conductor' || newMsg.role === 'error') ? false : s.conductorTyping;
        return { messages: [...s.messages, newMsg], conductorTyping };
      });
    }
  }

  return {
    models: [], selectedModel: null, pendingModel: null, modelError: '',
    selectModel(id) {
      const s = get();
      if (s.connectionStatus !== 'ready' || s.pendingModel !== null ||
          !s.models.some((m) => m.id === id) || s.selectedModel === id) return;
      set({ pendingModel: id, modelError: '' });
      try {
        if (!client.send({ llm: id })) throw new Error('指挥家未连接');
      } catch (error) {
        set({ pendingModel: null, modelError: String(error) });
        return;
      }
      modelTimer = setTimeout(() => {
        modelTimer = undefined;
        set({ pendingModel: null, modelError: '模型选择确认超时，结果尚未确认；请重新连接同步' });
      }, 10_000);
    },
    connectionStatus: 'offline',
    connectionError: '',
    async ensureConnected() {
      set({ connectionError: '' });
      try { await client.ensureConnected(); }
      catch (error) { set({ connectionError: String(error) }); }
    },
    messages: [],
    workers: [],
    conductorTyping: false,

    connect: () => client.connect(),

    disconnect() {
      client.disconnect();
      set({ messages: [], workers: [], conductorTyping: false });
    },

    sendMessage(msg, files, images) {
      const payload: Record<string, unknown> = { msg };
      if (files && files.length > 0) payload.files = files;
      if (images && images.length > 0) payload.images = images;
      if (!client.send(payload)) return;

      const localMsg: ConductorMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        msg,
        ts: Date.now() / 1000,
        files,
        images,
        _local: true,
      };
      set((s) => ({ messages: [...s.messages, localMsg], conductorTyping: true }));
    },

    killWorker: (id) => client.cancelWorker(id).catch(() => {}),
  };
});
