import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChatStore } from '../../../stores/chat';
import { useSettingsStore } from '../../../stores/settings';
import { useI18n } from '../../../i18n';

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCompact, setIsCompact] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { lang, t } = useI18n();

  const profiles = useSettingsStore((s) => s.modelProfiles);
  const selectedNo = useChatStore((s) => s.model?.llmNo);
  const selectModel = useChatStore((s) => s.selectModel);
  const isLoading = profiles.length === 0;
  const currentProfile = profiles.find((p) => p.id === selectedNo);
  const chipLabel = currentProfile?.name || currentProfile?.varName || t('model.menuLabel');
  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => `${p.name} ${p.varName || ''} ${p.model || ''}`.toLowerCase().includes(q));
  }, [profiles, search]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      if (!v) setSearch('');
      return !v;
    });
  }, []);

  const handleSelect = useCallback((id: number) => {
    selectModel(id);
    setOpen(false);
  }, [selectModel]);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  // Compact mode: observe toolbar width
  useEffect(() => {
    const toolbar = wrapRef.current?.closest('[data-slot="composer-toolbar"]') as HTMLElement | null;
    if (!toolbar) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? toolbar.offsetWidth;
      setIsCompact(width < 320);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    function onHotkey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < profiles.length) {
          e.preventDefault();
          selectModel(profiles[idx].id);
        }
      }
    }
    document.addEventListener('keydown', onHotkey);
    return () => document.removeEventListener('keydown', onHotkey);
  }, [profiles, selectModel]);

  const handleOpenSettings = useCallback(() => {
    setOpen(false);
    useSettingsStore.getState().open();
  }, []);

  return (
    <div ref={wrapRef} data-slot="model-selector">
      <button
        ref={btnRef}
        data-slot="model-chip"
        data-loading={isLoading ? '' : undefined}
        data-open={open ? '' : undefined}
        onClick={toggle}
        title={chipLabel}
      >
        {isLoading ? (
          <span data-slot="model-chip-spinner"><span /></span>
        ) : (
          <>
            {!isCompact && <span data-slot="model-chip-label">{chipLabel}</span>}
            <span data-slot="model-chip-caret" data-open={open ? '' : undefined}>
              <CaretIcon />
            </span>
          </>
        )}
      </button>

      {open && !isLoading && (
        <div ref={menuRef} data-slot="model-menu">
          {/* Search */}
          <div data-slot="model-menu-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="text"
              placeholder={t('model.menuLabel')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-slot="model-menu-search-input"
            />
          </div>

          <div data-slot="model-menu-body">
            {filteredProfiles.map((p) => (
              <button
                key={p.id}
                data-slot="model-menu-item"
                data-active={p.id === selectedNo ? '' : undefined}
                onClick={() => handleSelect(p.id)}
                title={p.model}
              >
                {p.id === selectedNo && <span data-slot="model-check">✓</span>}
                <span data-slot="model-menu-name">{p.name || p.varName}</span>
              </button>
            ))}
            {filteredProfiles.length === 0 && (
              <div data-slot="model-menu-empty">{t('set.noModels')}</div>
            )}
          </div>

          {/* Footer actions */}
          <div data-slot="model-menu-footer">
            <button data-slot="model-menu-action" onClick={handleOpenSettings}>
              {lang === 'zh' ? '编辑模型…' : 'Edit models…'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaretIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" data-slot="model-menu-search-icon">
      <path d="M7 12A5 5 0 107 2a5 5 0 000 10zM14 14l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
