// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { tauriInvoke as invoke } from '../utils/tauri';
vi.mock('../utils/tauri', () => ({ tauriInvoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../stores/chat', () => ({ useChatStore: { getState: () => ({ activeSessionId: 'test' }) } }));
vi.mock('../services/bridge', () => ({ bridgeFetch: vi.fn().mockResolvedValue({ session: { cwd: 'C:/work' } }) }));
import { MarkdownPart } from '../components/chat/Thread/parts/MarkdownPart';
afterEach(cleanup);
it.each([
  ['[网页](https://example.com)', '网页'],
  ['https://example.com', 'https://example.com'],
  ['www.example.com', 'www.example.com'],
  ['user@example.com', 'user@example.com'],
  ['[下载](report.zip)', '下载'],
  ['[下载](folder/中文%20报告.zip "原始标题")', ''],
  ['<https://example.com/a?x=1&y=2>', ''],
  ['[本地](<C:\\work\\report.md>)', ''],
  ['[本地](file:///C:/report.md)', '本地'],
  ['[附件](sandbox:/mnt/data/report.zip)', '附件'],
  ['[**加粗文字**](https://example.com)', '加粗文字'],
])('renders link as text: %s', (content) => {
  const { container } = render(<MarkdownPart content={content} />);
  expect(container.textContent).toBe(content);
  for (const a of container.querySelectorAll('a')) {
    expect(a.textContent).toBeTruthy();
    expect(a.getAttribute('title')).toBeNull();
  }
});

it('keeps reference definitions and link syntax visible', () => {
  const content = '[下载][report]\n\n[report]: folder/report.zip';
  const { container } = render(<MarkdownPart content={content} />);
  expect(container.textContent).toContain('[下载][report]');
  expect(container.textContent).toContain('[report]: folder/report.zip');
  expect(container.querySelector('a')?.textContent).toBe('folder/report.zip');
});

it.each([
  ['[下载](folder/report.zip)', 'folder/report.zip', 'C:/work'],
  ['[网页](https://example.com)', 'https://example.com', null],
])('opens visible target via native command: %s', async (content, target, cwd) => {
  vi.mocked(invoke).mockClear();
  const { getByRole } = render(<MarkdownPart content={content} />);
  fireEvent.click(getByRole('link'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_message_target', { target, cwd }));
});
it.each(['[x](javascript:alert)', '[x](sandbox:/mnt/data/test)', 'user@example.com'])('does not activate unsupported protocols: %s', (content) => {
  const { container } = render(<MarkdownPart content={content} />);
  expect(container.textContent).toBe(content);
  expect(container.querySelector('a')).toBeNull();
});
