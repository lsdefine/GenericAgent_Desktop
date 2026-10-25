import { create } from 'zustand';
import {
  fetchTokenHistory as apiFetchHistory,
  fetchConductorTokenStats,
  emptySnapshot,
  type TokenRecord,
  type HistoryEntry,
  type TokenSnapshot,
} from '../services/token-api';

export type { TokenRecord, HistoryEntry, TokenSnapshot };
export { emptySnapshot };

const POLL_INTERVAL_MS = 15_000;

interface TokenState {
  history: HistoryEntry[];
  snapshot: TokenSnapshot;
  loading: boolean;
  error: string | null;

  conductorHistory: HistoryEntry[];
  conductorSnapshot: TokenSnapshot;
  conductorLoading: boolean;
  conductorOffline: boolean;

  dateRange: [Date | null, Date | null];

  fetchHistory: (background?: boolean) => Promise<void>;
  fetchConductorHistory: () => Promise<void>;
  setDateRange: (range: [Date | null, Date | null]) => void;
  resetFilters: () => void;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useTokenStore = create<TokenState>((set, get) => {
  return {
    history: [],
    snapshot: emptySnapshot(),
    loading: true,
    error: null,

    conductorHistory: [],
    conductorSnapshot: emptySnapshot(),
    conductorLoading: false,
    conductorOffline: false,

    dateRange: [null, null],

    async fetchHistory(background = false) {
      if (!background) set({ loading: true, error: null });
      try {
        const data = await apiFetchHistory();
        set({
          history: data.history,
          snapshot: data.snap,
          loading: false,
          error: null,
        });
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    async fetchConductorHistory() {
      set({ conductorLoading: true });
      try {
        const records = await fetchConductorTokenStats();
        const entries: HistoryEntry[] = records.map((r, i) => ({
          id: `cond-${i}`,
          title: r.thread || `Conductor ${i + 1}`,
          input: r.input,
          output: r.output,
          cacheWrite: r.cacheCreate,
          cacheRead: r.cacheRead,
          model: r.model,
          ts: Date.now(),
        }));

        const snap: TokenSnapshot = entries.reduce(
          (acc, e) => ({
            totalInput: acc.totalInput + e.input,
            totalOutput: acc.totalOutput + e.output,
            totalCacheWrite: acc.totalCacheWrite + e.cacheWrite,
            totalCacheRead: acc.totalCacheRead + e.cacheRead,
          }),
          emptySnapshot(),
        );

        set({
          conductorHistory: entries,
          conductorSnapshot: snap,
          conductorLoading: false,
          conductorOffline: false,
        });
      } catch {
        set({ conductorLoading: false, conductorOffline: true });
      }
    },

    startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        get().fetchHistory(true);
        get().fetchConductorHistory();
      }, POLL_INTERVAL_MS);
    },

    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    setDateRange(range: [Date | null, Date | null]) {
      set({ dateRange: range });
    },

    resetFilters() {
      set({ dateRange: [null, null] });
    },
  };
});
