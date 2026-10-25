import { tauriInvoke } from '../utils/tauri';

/** Desktop lifecycle IPC. Runtime services never start or stop bridge themselves. */
export interface BridgeConfig { pythonPath: string; projectDir: string }
export type BridgeAction = 'bootstrap' | 'start' | 'stop' | 'restart';

export async function controlBridge(action: BridgeAction, config?: BridgeConfig): Promise<void> {
  await tauriInvoke(config ? 'start_bridge_with_config' : `${action}_bridge`, config ? { ...config } : undefined);
}

export const getSourceDirectory = () => tauriInvoke<string>('get_ga_source');
export const setSourceDirectory = (dir: string) => tauriInvoke<string>('set_ga_source', { dir });
export const clearSourceDirectory = () => tauriInvoke<void>('clear_ga_source');
export const moveRuntimeDirectory = (targetParent: string) => tauriInvoke<string>('move_ga_runtime', { targetParent });
