import { create } from 'zustand';
import type { ModelProfile } from '../services/bridge';
import * as bridge from '../services/bridge';

const STORE_KEYS = {
  lang: 'ga_lang',
  theme: 'ga_theme',
  appearance: 'ga_appearance',
  fontSize: 'ga_font_size',
} as const;

function syncBootCache(state: SettingsState) {
  try {
    localStorage.setItem(STORE_KEYS.lang, state.lang);
    localStorage.setItem(STORE_KEYS.appearance, state.appearance);
    localStorage.setItem(STORE_KEYS.fontSize, String(state.chatFontSize));
  } catch (_) { /* private browsing */ }
}

function applyToDOM(appearance: string, chatFontSize: number) {
  const root = document.documentElement;
  root.dataset.appearance = appearance;
  delete root.dataset.plain;
  root.dataset.chatFont = String(chatFontSize);
  root.style.setProperty('--chat-font', chatFontSize + 'px');
  if (appearance === 'dark') {
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.body.removeAttribute('theme-mode');
  }
}

interface SettingsState {
  visible: boolean;
  syncError: string | null;
  dirty: boolean;
  saving: boolean;
  appearance: 'light' | 'dark';
  chatFontSize: number;
  lang: 'zh' | 'en';
  modelProfiles: ModelProfile[];

  open: () => void;
  close: () => void;
  setAppearance: (app: 'light' | 'dark') => void;
  setChatFontSize: (size: number) => void;
  setLang: (lang: 'zh' | 'en') => void;
  setModelProfiles: (profiles: ModelProfile[]) => void;
  loadFromBridge: () => Promise<void>;
  persist: () => Promise<void>;
}

function readInitialState() {
  const root = document.documentElement;
  return {
    appearance: (root.dataset.appearance === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    chatFontSize: parseInt(root.dataset.chatFont || '14', 10) || 14,
    lang: (root.lang === 'en' ? 'en' : 'zh') as 'zh' | 'en',
  };
}

let revision = 0;
let saveChain: Promise<void> = Promise.resolve();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  visible: false,
  syncError: null,
  dirty: localStorage.getItem('ga_settings_pending') === '1',
  saving: false,
  modelProfiles: [],
  ...readInitialState(),

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),

  setAppearance: (app) => {
    set({ appearance: app });
    applyToDOM(app, get().chatFontSize);
    get().persist();
  },

  setChatFontSize: (size) => {
    const clamped = Math.max(10, Math.min(20, size));
    set({ chatFontSize: clamped });
    applyToDOM(get().appearance, clamped);
    get().persist();
  },

  setLang: (lang) => {
    set({ lang });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    get().persist();
  },

  setModelProfiles: (profiles) => set({ modelProfiles: profiles }),

  loadFromBridge: async () => {
    const started = revision;
    try {
      const [config, profiles] = await Promise.all([
        bridge.getConfig(),
        bridge.getModelProfiles(),
      ]);
      set({ modelProfiles: profiles });
      if (get().dirty || started !== revision) return;
      set({
        syncError: null,
        appearance: config.appearance === 'dark' ? 'dark' : 'light',
        chatFontSize: config.fontSize || 14,
        lang: config.lang === 'en' ? 'en' : 'zh',
        modelProfiles: profiles,
      });
      const s = get();
      applyToDOM(s.appearance, s.chatFontSize);
      document.documentElement.lang = s.lang === 'en' ? 'en' : 'zh-CN';
      syncBootCache(s);
    } catch (error) { set({ syncError: String(error) }); }
  },

  persist: () => {
    const current = ++revision;
    const s = get();
    syncBootCache(s);
    try { localStorage.setItem('ga_settings_pending', '1'); } catch {}
    set({ dirty: true, saving: true, syncError: null });
    saveChain = saveChain.then(async () => {
      if (current !== revision) return;
      try {
        await bridge.saveConfig({ lang: s.lang, theme: '1', appearance: s.appearance, plain: false, fontSize: s.chatFontSize });
        if (current !== revision) return;
        try { localStorage.removeItem('ga_settings_pending'); } catch {}
        set({ dirty: false, saving: false, syncError: null });
      } catch (error) {
        if (current === revision) set({ saving: false, syncError: String(error) });
      }
    });
    return saveChain;
  },
}));
