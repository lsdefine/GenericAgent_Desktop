import { useCallback, useEffect } from 'react';

export type CTAState = 'send' | 'stop' | 'disabled';

export function computeCTAState(
  isGenerating: boolean,
  hasContent: boolean,
  hasPendingUploads: boolean = false,
): CTAState {
  if (hasPendingUploads) return 'disabled';
  if (isGenerating) return 'stop';
  if (hasContent) return 'send';
  return 'disabled';
}

interface Props {
  state: CTAState;
  onSend: () => void;
  onStop: () => void;
}

export function PrimaryCTA({ state, onSend, onStop }: Props) {
  const handleClick = useCallback(() => {
    switch (state) {
      case 'send': onSend(); break;
      case 'stop': onStop(); break;
    }
  }, [state, onSend, onStop]);

  useEffect(() => {
    if (state !== 'stop') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onStop();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onStop]);

  const label = state === 'stop' ? 'Stop generating'
    : 'Send message';

  return (
    <button
      data-slot="composer-cta"
      data-state={state}
      onClick={handleClick}
      disabled={state === 'disabled'}
      aria-label={label}
      title={label}
    >
      {state === 'stop' && <StopIcon />}
      {(state === 'send' || state === 'disabled') && <SendIcon />}
    </button>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 14V2m0 0L3 7m5-5l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}
