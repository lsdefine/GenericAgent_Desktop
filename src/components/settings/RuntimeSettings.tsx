import { useEffect } from 'react';
import { Banner, Button } from '@douyinfe/semi-ui';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import { AppearanceSection } from './AppearanceSection';
import { LanguageSection } from './LanguageSection';
import { ModelSection } from './ModelSection';
import { RuntimeFeatures } from './RuntimeFeatures';

export function RuntimeSettings(props: { onAdd: () => void; onEdit: (id: number) => void }) {
  const load = useSettingsStore(s => s.loadFromBridge);
  const { t } = useI18n();
  const { dirty, saving, syncError, persist } = useSettingsStore();
  useEffect(() => { void load(); }, [load]);
  return (
    <div data-settings="runtime">
      {(dirty || syncError) && <Banner type={syncError ? 'warning' : 'info'} description={
        <span>{t(saving ? 'set.syncing' : dirty ? 'set.unsynced' : 'set.loadFailed')} {syncError}
          {!saving && <Button size="small" onClick={() => void (dirty ? persist() : load())}>{t('set.retrySync')}</Button>}
        </span>
      } />}
      <AppearanceSection />
      <LanguageSection />
      <ModelSection {...props} />
      <RuntimeFeatures />
    </div>
  );
}
