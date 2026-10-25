export function isTauri(): boolean {
  return typeof (window as any).__TAURI__ !== 'undefined';
}

export async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = (window as any).__TAURI__?.core?.invoke;
  if (!invoke) throw new Error('This action requires the desktop shell');
  return invoke(cmd, args);
}

export const pickDirectory = (title: string) => tauriInvoke<string | null>('pick_directory', { title });
export const exportMykey = (content: string) => tauriInvoke<string | null>('export_mykey', { content });
