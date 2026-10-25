// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn() } }));
vi.mock('../components/settings/ModelSection', () => ({ ModelSection: () => <div>models</div> }));
vi.mock('../components/settings/AddModelView', () => ({ AddModelView: () => <div>editor</div> }));
import { SettingsModal } from '../components/settings/SettingsModal';
import { useSettingsStore } from '../stores/settings';
import { controlBridge, getSourceDirectory, setSourceDirectory, clearSourceDirectory, moveRuntimeDirectory } from '../services/bridge-lifecycle';
import { addModelProfile } from '../services/bridge';
const fetchMock = vi.fn();
const invoke = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/config') ? { config: {} } : { profiles: [] })));
  invoke.mockReset().mockResolvedValue('/source');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('__TAURI__', { core: { invoke } });
  useSettingsStore.setState({ visible: true, lang: 'zh', modelProfiles: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('routes startup configuration and lifecycle exclusively through desktop IPC', async () => {
  await getSourceDirectory();
  await setSourceDirectory('/new');
  await clearSourceDirectory();
  await moveRuntimeDirectory('/parent');
  await controlBridge('restart');
  await controlBridge('start', { pythonPath: '/py', projectDir: '/source' });
  expect(invoke.mock.calls).toEqual([
    ['get_ga_source', undefined], ['set_ga_source', { dir: '/new' }], ['clear_ga_source', undefined],
    ['move_ga_runtime', { targetParent: '/parent' }], ['restart_bridge', undefined],
    ['start_bridge_with_config', { pythonPath: '/py', projectDir: '/source' }],
  ]);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('routes model changes exclusively through HTTP bridge', async () => {
  await addModelProfile({ name: 'test' });
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/model-profiles$/);
  expect(invoke).not.toHaveBeenCalled();
});
it('switches settings ownership and reopens startup without loading runtime config', async () => {
  const ui = render(<SettingsModal />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText('启动设置'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_ga_source', undefined));
  expect(document.querySelector('[data-settings="runtime"]')).toBeNull();
  expect(document.querySelector('[data-settings="startup"]')).not.toBeNull();
  fetchMock.mockClear();
  act(() => { useSettingsStore.getState().close(); });
  act(() => { window.dispatchEvent(new Event('ga:open-settings')); });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText('运行设置'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(document.querySelector('[data-settings="startup"]')).toBeNull();
});
