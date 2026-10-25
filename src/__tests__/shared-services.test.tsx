// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn() } }));
vi.mock('../hooks/useBridgeStatus', () => ({ useBridgeStatus: () => 'connected' }));
vi.mock('../services/ws', () => ({ subscribe: vi.fn() }));
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../components/services/ChannelLogModal', () => ({ ChannelLogModal: () => null }));
import { StatusPanel } from '../components/services/StatusPanel';
import { useServicesStore } from '../stores/services';
afterEach(cleanup);
it.each([true, false])('shared services expose no lifecycle takeover (running=%s)', (running) => {
  useServicesStore.setState({ loading: false, services: [
    { name: 'conductor', pid: null, memMb: null, cpuPct: null, lastError: '', id: 'frontends/conductor.py', status: running ? 'running' : 'offline', running, managed: false, canStart: true },
    { name: 'scheduler', pid: null, memMb: null, cpuPct: null, lastError: '', id: 'reflect/scheduler.py', status: running ? 'running' : 'offline', running, managed: false, canStart: true },
  ] });
  const ui = render(<StatusPanel />);
  expect(ui.queryByText('act.stop')).toBeNull();
  expect(ui.queryByText('act.exit')).toBeNull();
  expect(ui.queryByText('act.restart')).toBeNull();
  expect(ui.queryAllByText('act.start')).toHaveLength(running ? 0 : 2);
});
