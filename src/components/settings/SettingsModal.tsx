import { useEffect, useState, useCallback } from 'react';
import { Modal, Tabs } from '@douyinfe/semi-ui';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import './settings.css';
import { RuntimeSettings } from './RuntimeSettings';
import { StartupSettings } from './StartupSettings';
import { AddModelView } from './AddModelView';

type View = 'main' | 'addModel';

export function SettingsModal() {
  const { visible, open, close } = useSettingsStore();
  const { t } = useI18n();

  const [section, setSection] = useState('runtime');
  const [view, setView] = useState<View>('main');
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    const handler = () => {
      open();
    };
    const closeHandler = () => close();
    window.addEventListener('ga:open-settings', handler);
    window.addEventListener('ga:close-settings', closeHandler);
    return () => {
      window.removeEventListener('ga:open-settings', handler);
      window.removeEventListener('ga:close-settings', closeHandler);
    };
  }, [open, close]);

  useEffect(() => {
    if (!visible) {
      setView('main');
      setEditingId(null);
    }
  }, [visible]);

  const handleAddModel = useCallback(() => {
    setEditingId(null);
    setView('addModel');
  }, []);

  const handleEditModel = useCallback((id: number) => {
    setEditingId(id);
    setView('addModel');
  }, []);

  const handleModelDone = useCallback(() => {
    setView('main');
    setEditingId(null);
  }, []);

  const title = view === 'main'
    ? t('modal.settings')
    : (editingId != null ? t('modal.editModel') : t('modal.addModel'));

  return (
    <Modal
      visible={visible}
      onCancel={close}
      title={title}
      footer={null}
      width={870}
      centered
      closeOnEsc
      className="ga-settings-dialog"
    >
      {view === 'main' ? (
        <>
          <Tabs activeKey={section} onChange={setSection}>
            <Tabs.TabPane itemKey="runtime" tab={t('set.runtime')} />
            <Tabs.TabPane itemKey="startup" tab={t('set.startup')} />
          </Tabs>
          {visible && (section === 'startup'
            ? <StartupSettings />
            : <RuntimeSettings onAdd={handleAddModel} onEdit={handleEditModel} />)}
        </>
      ) : (
        <AddModelView editingId={editingId} onDone={handleModelDone} />
      )}
    </Modal>
  );
}
