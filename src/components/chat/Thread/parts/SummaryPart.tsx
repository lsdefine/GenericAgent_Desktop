import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import { tauriInvoke as invoke } from '../../../../utils/tauri';
import { useChatStore } from '../../../../stores/chat';
import { bridgeFetch } from '../../../../services/bridge';
import { useNotificationStore } from '../../../../stores/notifications';
import { remarkPlainLinks } from '../../../../lib/remark-plain-links';
import { preprocessMarkdown } from '../../../../lib/markdown-preprocess';

const KATEX_OPTIONS = {
  strict: 'ignore' as const,
  trust: true,
};

interface Props {
  content: string;
}

const components: Components = {
  a({ children, node }) {
    const target = node?.properties?.['data-target'];
    if (typeof target !== 'string') return <>{children}</>;
    return <a href="#" onClick={async (event) => {
      event.preventDefault();
      try {
        const sid = useChatStore.getState().activeSessionId;
        const cwd = !/^https?:/i.test(target) && sid
          ? (await bridgeFetch(`/session/${encodeURIComponent(sid)}`)).session.cwd : null;
        await invoke('open_message_target', { target, cwd });
      } catch (error) {
        useNotificationStore.getState().notify({ kind: 'error', message: String(error) });
      }
    }}>{children}</a>;
  },
};

export const SummaryPart = memo(function SummaryPart({ content }: Props) {
  return (
    <div data-slot="summary-block">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkPlainLinks]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={components}
      >
        {preprocessMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
});
