import { useChatStore } from '../../../stores/chat';
import { useSettingsStore } from '../../../stores/settings';

const LABELS = {
  thinking: { zh: '思考中…', en: 'Thinking…' },
};

export function StatusStack() {
  const isGenerating = useChatStore((s) => s.status === 'running');
  const lang = useSettingsStore((s) => s.lang);

  if (!isGenerating) return null;

  const t = (key: keyof typeof LABELS) => LABELS[key][lang] || LABELS[key].en;

  return (
    <div data-slot="composer-status-stack">
      {isGenerating && (
        <div data-slot="status-running">
          <span data-slot="status-dot" />
          <span data-slot="status-label">{t('thinking')}</span>
        </div>
      )}

    </div>
  );
}
