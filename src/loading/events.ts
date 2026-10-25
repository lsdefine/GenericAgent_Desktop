import type { BootstrapAction } from './store';

type Dispatch = (action: BootstrapAction) => void;

function runDevMock(dispatch: Dispatch) {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('mock') || 'success';

  const success: Array<[number, BootstrapAction]> = [
    [500, { type: 'start', mode: 'prepare' }],
    [1200, { type: 'stage', key: 'start', state: 'running', pct: 5 }],
    [1800, { type: 'log', line: 'Checking embedded python...' }],
    [2200, { type: 'stage', key: 'start', state: 'done', pct: 10 }],
    [2400, { type: 'stage', key: 'venv', state: 'running', pct: 15 }],
    [2800, { type: 'log', line: 'Creating virtual environment...' }],
    [3500, { type: 'stage', key: 'venv', state: 'done', pct: 30 }],
    [3700, { type: 'stage', key: 'deps', state: 'running', pct: 35 }],
    [4200, { type: 'log', line: 'Installing fastapi uvicorn websockets...' }],
    [5000, { type: 'log', line: 'Processing dependencies...' }],
    [6000, { type: 'stage', key: 'deps', state: 'done', pct: 75 }],
    [6200, { type: 'stage', key: 'done', state: 'done', pct: 90 }],
    [6500, { type: 'stage', key: 'starting', state: 'running', pct: 95 }],
    [7500, { type: 'stage', key: 'starting', state: 'done', pct: 100 }],
    [8000, { type: 'ready' }],
  ];

  const fail: Array<[number, BootstrapAction]> = [
    [500, { type: 'start', mode: 'prepare' }],
    [1200, { type: 'stage', key: 'start', state: 'running', pct: 5 }],
    [1800, { type: 'log', line: 'Checking embedded python...' }],
    [2200, { type: 'stage', key: 'start', state: 'done', pct: 10 }],
    [2400, { type: 'stage', key: 'venv', state: 'running', pct: 15 }],
    [2800, { type: 'log', line: 'Creating virtual environment...' }],
    [3500, { type: 'stage', key: 'venv', state: 'done', pct: 30 }],
    [3700, { type: 'stage', key: 'deps', state: 'running', pct: 35 }],
    [4200, { type: 'log', line: 'pip install --no-index --find-links wheels/ fastapi' }],
    [4800, { type: 'log', line: 'ERROR: Could not find a version that satisfies the requirement uvicorn' }],
    [5200, { type: 'stage', key: 'deps', state: 'failed', pct: 40 }],
    [5500, { type: 'log', line: 'prepare exited with status 1' }],
    [6000, { type: 'failed', error: 'prepare exited with status 1: pip install failed — missing wheel for uvicorn. 请检查 wheels/ 目录完整性或手动配置 Python 路径。' }],
  ];

  const hot: Array<[number, BootstrapAction]> = [
    [300, { type: 'start', mode: 'hot_start' }],
    [1200, { type: 'ready' }],
  ];

  const sequences: Record<string, Array<[number, BootstrapAction]>> = { success, fail, hot };
  const seq = sequences[scenario] || success;

  const timers = seq.map(([ms, payload]) => setTimeout(() => dispatch(payload), ms));
  return () => timers.forEach(clearTimeout);
}

/** Subscribe before requesting bootstrap so no progress is lost during page load. */
export async function subscribe(dispatch: Dispatch): Promise<() => void> {
  const tauri = (window as any).__TAURI__;
  if (!tauri?.event?.listen) return runDevMock(dispatch);
  return tauri.event.listen('bootstrap', (event: { payload: BootstrapAction }) => dispatch(event.payload));
}
