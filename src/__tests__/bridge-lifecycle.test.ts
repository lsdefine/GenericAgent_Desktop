import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { controlBridge } from '../services/bridge-lifecycle';

afterEach(() => vi.unstubAllGlobals());

describe('desktop bridge lifecycle', () => {
  it.each(['bootstrap', 'start', 'stop', 'restart'] as const)('routes %s to the shell', async (action) => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
    await controlBridge(action);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(`${action}_bridge`, undefined);
  });

  it('passes explicit setup configuration to the shell', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
    const config = { pythonPath: 'python', projectDir: '/runtime' };
    await controlBridge('start', config);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('start_bridge_with_config', config);
  });

  it('propagates lifecycle failure for the caller to display', async () => {
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: vi.fn().mockRejectedValue(new Error('start failed')) } } });
    await expect(controlBridge('start')).rejects.toThrow('start failed');
  });

  it('does not silently fall back to an HTTP stop outside the shell', async () => {
    vi.stubGlobal('window', {});
    await expect(controlBridge('stop')).rejects.toThrow('requires the desktop shell');
  });

  it('loads the React bootstrap entry without a shadowing public page', () => {
    expect(readFileSync('loading.html', 'utf8')).toContain('/src/loading.tsx');
    expect(existsSync('public/loading.html')).toBe(false);
  });
});
