import { BRIDGE_BASE } from './constants';

/** Optional launch assistance; never a prerequisite for reading conductor state. */
export async function startConductorIfMissing(): Promise<void> {
  const response = await fetch(`${BRIDGE_BASE}/services/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'frontends/conductor.py' }), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
}
