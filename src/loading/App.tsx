import { useReducer, useEffect, useCallback } from 'react';
import { reducer, initialState } from './store';
import { subscribe } from './events';
import { controlBridge, type BridgeConfig } from '../services/bridge-lifecycle';
import { LoadingScreen } from './Loading';
import { ProgressScreen } from './Progress';
import { ReadyScreen } from './Ready';
import { SetupScreen } from './Setup';

export function LoadingApp() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const run = useCallback(async (config?: BridgeConfig, initial = false) => {
    dispatch({ type: 'retry' });
    dispatch({ type: 'start', mode: 'cold_start' });
    try {
      await controlBridge(initial ? 'bootstrap' : 'start', config);
      dispatch({ type: 'ready' });
    } catch (error) {
      dispatch({ type: 'failed', error: String(error) });
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void subscribe(dispatch).then((off) => {
      if (disposed) { off(); return; }
      cleanup = off;
      if ((window as any).__TAURI__) void run(undefined, true);
    }).catch((error) => {
      if (!disposed) dispatch({ type: 'failed', error: String(error) });
    });
    return () => { disposed = true; cleanup?.(); };
  }, [run]);

  const handleRetry = useCallback(() => { void run(); }, [run]);

  let content: React.ReactNode;
  switch (state.route) {
    case 'loading':
      content = <LoadingScreen />;
      break;
    case 'progress':
      content = <ProgressScreen stages={state.stages} overallPct={state.overallPct} logs={state.logs} />;
      break;
    case 'ready':
      content = <ReadyScreen />;
      break;
    case 'setup':
      content = <SetupScreen error={state.error} logs={state.logs} onRetry={handleRetry} onStart={run} />;
      break;
  }

  return (
    <div className="bootstrap-app" data-route={state.route}>
      {content}
    </div>
  );
}
