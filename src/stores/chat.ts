import { create } from 'zustand';
import { adoptComposerDraft, deleteComposerDraft } from './composerDrafts';
import { restoreSession, createSession, sendPrompt, pollMessages, cancelGeneration, listSessions, deleteSession as apiDeleteSession, renameSession as apiRenameSession, pinSession as apiPinSession, type Message, type SessionInfo, type SessionModel, setSessionModel } from '../services/chat';
import { subscribe, onBridgeStatusChange } from '../services/ws';
import { useNotificationStore } from './notifications';

const PARTIAL_MSG_ID = '__partial__';
const POLL_INTERVAL_MS = 1000;

export interface SendOptions {
  files?: { name: string; path: string; size?: number }[];
  images?: { name: string; path: string; base64?: string }[];
}

interface ChatState {
  activeSessionId: string | null;
  loadingSession: boolean;
  model: SessionModel | null;
  selectModel: (no: number) => Promise<void>;
  messages: Message[];
  status: 'idle' | 'running';
  sessions: SessionInfo[];
  runningSessions: Set<string>;
  turnStartedAt: number | null;

  newSession: () => Promise<void>;
  sendMessage: (text: string, opts?: SendOptions) => Promise<boolean>;
  cancel: () => Promise<void>;
  setActiveSession: (id: string | null) => void;
  loadSessions: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
}

// rAF throttle state for partial updates (WS path)
let pendingPartial: Message | null = null;
let rafId: number | null = null;

// Fallback polling state
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollGeneration = 0;

// Per-session turn start timestamps — persists across session switches
const turnStartMap = new Map<string, number>();

export const useChatStore = create<ChatState>((set, get) => {
  function mergeMessages(current: Message[], incoming: Message[], partial?: Message): Message[] {
    const withoutPartial = current.filter((m) => m.id !== PARTIAL_MSG_ID);
    const localMsgs = withoutPartial.filter((m) => String(m.id).startsWith('local-'));
    let merged = withoutPartial.filter((m) => !String(m.id).startsWith('local-'));

    for (const inc of incoming) {
      if (merged.some((m) => m.id === inc.id)) continue;
      const localIdx = localMsgs.findIndex((l) => l.role === inc.role && l.content === inc.content);
      if (localIdx >= 0) {
        localMsgs.splice(localIdx, 1);
      }
      merged.push(inc);
    }
    merged = [...merged, ...localMsgs];
    merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    if (partial) {
      merged.push({ ...partial, id: PARTIAL_MSG_ID, status: 'in_progress' });
    }
    return merged;
  }

  function inferTurnStart(messages: Message[]): number {
    // Find the last user message's createdAt as the best approximation of turn start
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].createdAt) {
        return messages[i].createdAt!;
      }
    }
    return Date.now();
  }

  function setTurnStart(sessionId: string, ts: number) {
    turnStartMap.set(sessionId, ts);
    const { activeSessionId } = get();
    if (sessionId === activeSessionId) {
      set({ turnStartedAt: ts });
    }
  }

  function clearTurnStart(sessionId: string) {
    turnStartMap.delete(sessionId);
    const { activeSessionId } = get();
    if (sessionId === activeSessionId) {
      set({ turnStartedAt: null });
    }
  }

  function flushPartial() {
    rafId = null;
    if (!pendingPartial) return;
    const partial = pendingPartial;
    pendingPartial = null;
    const { messages } = get();
    const withoutPartial = messages.filter((m) => m.id !== PARTIAL_MSG_ID);
    set({ messages: [...withoutPartial, partial] });
  }

  function startPolling() {
    stopPolling();
    const generation = pollGeneration;
    let inFlight = false;
    pollTimer = setInterval(() => {
      const { activeSessionId, status } = get();
      if (!activeSessionId || status !== 'running') { stopPolling(); return; }
      if (inFlight) return;
      inFlight = true;
      pollMessages(activeSessionId).then((result) => {
        if (generation !== pollGeneration || get().activeSessionId !== activeSessionId) return;
        const runningSessions = new Set(get().runningSessions);
        if (result.status === 'running') runningSessions.add(activeSessionId);
        else runningSessions.delete(activeSessionId);
        set((s) => ({
          messages: mergeMessages(s.messages, result.messages, result.partial),
          status: result.status,
          runningSessions,
          turnStartedAt: result.status === 'running' ? s.turnStartedAt : null,
        }));
        if (result.model) {
          set({ model: result.model });
        }
        if (result.status !== 'running') {
          clearTurnStart(activeSessionId);
          stopPolling();
        }
      }).catch(() => {}).finally(() => { inFlight = false; });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    pollGeneration++; // Ignore responses from stopped/replaced polling loops.
    if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Real-time partial updates via WebSocket — rAF throttled (faster path)
  subscribe('partial-update', (data: unknown) => {
    const evt = data as { sessionId?: string; content?: string; turn_segs?: string[]; curr_turn?: number };
    const { activeSessionId } = get();
    if (!evt.sessionId || evt.sessionId !== activeSessionId) return;

    pendingPartial = {
      id: PARTIAL_MSG_ID,
      role: 'assistant',
      content: evt.content || '',
      status: 'in_progress',
      turn_segs: evt.turn_segs,
    };

    if (rafId === null) {
      rafId = requestAnimationFrame(flushPartial);
    }
  });

  // On session-state change
  subscribe('session-state', (data: unknown) => {
    const evt = data as { sessionId?: string; status?: string };
    if (evt.sessionId && evt.status) {
      set((s) => {
        const next = new Set(s.runningSessions);
        if (evt.status === 'running') {
          next.add(evt.sessionId!);
        } else {
          next.delete(evt.sessionId!);
        }
        return { runningSessions: next };
      });
    }
    const { activeSessionId } = get();
    if (evt.sessionId && evt.sessionId === activeSessionId) {
      if (evt.status === 'running') {
        // Only record start time if not already tracked
        if (!turnStartMap.has(evt.sessionId)) {
          setTurnStart(evt.sessionId, Date.now());
        } else {
          set({ turnStartedAt: turnStartMap.get(evt.sessionId)! });
        }
        set({ status: 'running' });
        startPolling();
      } else if (evt.status === 'idle' || evt.status === 'error' || evt.status === 'cancelled') {
        stopPolling();
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        pendingPartial = null;

        clearTurnStart(evt.sessionId);
        set({ status: 'idle' });
        const generation = pollGeneration;
        pollMessages(activeSessionId).then((result) => {
          if (generation !== pollGeneration || get().activeSessionId !== activeSessionId) return;
          set((s) => ({
            messages: mergeMessages(
              s.messages.filter((m) => m.id !== PARTIAL_MSG_ID),
              result.messages,
              undefined,
            ),
          }));
          if (result.model) {
            set({ model: result.model });
          }
        }).catch(() => {});
      }
    }
    // Handle non-active session turn end — clean up map
    if (evt.sessionId && evt.sessionId !== activeSessionId) {
      if (evt.status === 'idle' || evt.status === 'error' || evt.status === 'cancelled') {
        turnStartMap.delete(evt.sessionId);
      } else if (evt.status === 'running' && !turnStartMap.has(evt.sessionId)) {
        turnStartMap.set(evt.sessionId, Date.now());
      }
    }
    if (evt.status === 'idle' || evt.status === 'error') {
      listSessions().then((sessions) => set({ sessions })).catch(() => {});
    }
  });

  listSessions().then((sessions) => set({ sessions })).catch(() => {});

  return {
    loadingSession: false,
    activeSessionId: null,
    model: null,
    messages: [],
    status: 'idle',
    sessions: [],
    runningSessions: new Set(),
    turnStartedAt: null,

    async selectModel(no: number) {
      if (get().loadingSession) return;
      let id = get().activeSessionId;
      try {
        if (!id) {
          id = await createSession();
          if (get().activeSessionId) return;
          adoptComposerDraft(id);
          set({ activeSessionId: id, model: null });
          get().loadSessions();
        }
        const model = await setSessionModel(id, no);
        if (get().activeSessionId === id) set({ model });
      } catch (error) {
        useNotificationStore.getState().notify({ kind: 'error', message: String(error) });
      }
    },

    async newSession() {
      get().setActiveSession(null);
    },

    async sendMessage(text: string, opts?: SendOptions) {
      if (get().loadingSession) return false;
      let id = get().activeSessionId;
      try {
        if (get().status === 'running') throw new Error('当前会话正在运行，请完成后再发送；输入已保留。');
        if (!id) {
          id = await createSession();
          if (get().activeSessionId) throw new Error('会话已切换，请在当前会话重新发送。');
          adoptComposerDraft(id);
          set({ activeSessionId: id });
          void get().loadSessions();
        }
        await sendPrompt(id, text, opts?.files, opts?.images);
        if (get().activeSessionId === id) {
          setTurnStart(id, Date.now());
          get().setActiveSession(id);
          startPolling();
        }
        return true;
      } catch (error) {
        useNotificationStore.getState().notify({ kind: 'error', message: `发送未确认，输入已保留；请检查会话后重试：${String(error)}` });
        // A lost response may still mean acceptance. Re-read, never auto-resend.
        if (id && get().activeSessionId === id) get().setActiveSession(id);
        return false;
      }
    },

    async cancel() {
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      await cancelGeneration(activeSessionId);
    },

    setActiveSession(id: string | null) {
      stopPolling();
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingPartial = null;
      // Restore turnStartedAt from map if switching to a running session
      const restoredTs = id ? turnStartMap.get(id) ?? null : null;
      set({ activeSessionId: id, loadingSession: !!id, model: null, messages: [], status: 'idle', turnStartedAt: restoredTs });
      if (id) {
        const pendingRestore = get().sessions.find((s) => s.id === id)?.loaded === false;
        (pendingRestore ? restoreSession(id) : Promise.resolve()).then(() => {
          void get().loadSessions();
          return pollMessages(id);
        }).then((result) => {
          if (get().activeSessionId !== id) return;
          const merged = mergeMessages([], result.messages, result.partial);
          set({ loadingSession: false, messages: merged, status: result.status, model: result.model ?? null });
          if (result.status === 'running') {
            // Use existing map entry, or infer from last user message
            if (!turnStartMap.has(id)) {
              const inferred = inferTurnStart(result.messages);
              setTurnStart(id, inferred);
            } else {
              set({ turnStartedAt: turnStartMap.get(id)! });
            }
            startPolling();
          } else {
            turnStartMap.delete(id);
            set({ turnStartedAt: null });
          }
        }).catch((error) => {
          if (get().activeSessionId === id) {
            set({ loadingSession: false, activeSessionId: null });
            useNotificationStore.getState().notify({ kind: 'error', message: String(error) });
          }
        });
      }
    },

    async loadSessions() {
      try {
        const sessions = await listSessions();
        const active = sessions.find((s) => s.id === get().activeSessionId);
        if (active?.loaded === false && !get().loadingSession) get().setActiveSession(null);
        set({ sessions });
      } catch {}
    },

    async deleteSession(id: string) {
      deleteComposerDraft(id);
      const { activeSessionId } = get();
      if (activeSessionId === id) {
        get().setActiveSession(null);
      }
      turnStartMap.delete(id);
      set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) }));
      try { await apiDeleteSession(id); } catch {}
    },

    async renameSession(id: string, title: string) {
      set((s) => ({
        sessions: s.sessions.map((ss) =>
          ss.id === id ? { ...ss, title, untitled: false } : ss,
        ),
      }));
      try { await apiRenameSession(id, title); } catch {}
    },

    async pinSession(id: string, pinned: boolean) {
      set((s) => ({
        sessions: s.sessions.map((ss) =>
          ss.id === id ? { ...ss, pinned } : ss,
        ),
      }));
      try { await apiPinSession(id, pinned); } catch {}
    },
  };
});

// Reload session list whenever the bridge (re)connects.
onBridgeStatusChange((status) => {
  if (status === 'ready') {
    useChatStore.getState().loadSessions();
  }
});
