import { useEffect, useState } from 'react';
import { Button, Modal, Toast } from '@douyinfe/semi-ui';
import { getSourceDirectory, setSourceDirectory, clearSourceDirectory, moveRuntimeDirectory } from '../../services/bridge-lifecycle';
import { isTauri, pickDirectory } from '../../utils/tauri';
import { useI18n } from '../../i18n';

export function StartupSettings() {
  const { t } = useI18n();
  const [gaSource, setGaSource] = useState('');
  const tauriAvailable = isTauri();
  useEffect(() => {
    if (tauriAvailable) getSourceDirectory().then(setGaSource).catch(error => Toast.error(String(error)));
  }, [tauriAvailable]);

  const handleConnectSource = async () => {
    try {
      const sourceDir = await pickDirectory(t('sys.gaSourcePickTitle'));
      if (!sourceDir) return;

      const result = await setSourceDirectory(sourceDir);
      setGaSource(String(result || sourceDir));
      Toast.success({ content: t('sys.gaSourceSet') });
    } catch (error) {
      Toast.error({ content: `${t('err.gaSourceSet')}: ${String(error)}` });
    }
  };

  const handleClearSource = () => {
    Modal.confirm({
      title: t('confirm.gaSourceClearTitle'),
      content: t('confirm.gaSourceClear'),
      onOk: async () => {
        try {
          await clearSourceDirectory();
          setGaSource('');
          Toast.success({ content: t('sys.gaSourceCleared') });
        } catch (error) {
          Toast.error({ content: `${t('err.gaSourceSet')}: ${String(error)}` });
        }
      },
    });
  };

  const handleMoveRuntime = async () => {
    try {
      const targetParent = await pickDirectory(t('sys.gaRuntimeMoveTitle'));
      if (!targetParent) return;

      const confirmed = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        Modal.confirm({
          title: t('confirm.gaRuntimeMoveTitle'),
          content: t('confirm.gaRuntimeMove'),
          onOk: () => settle(true),
          onCancel: () => settle(false),
        });
      });
      if (!confirmed) return;

      const result = await moveRuntimeDirectory(targetParent);
      setGaSource(String(result || ''));
      Toast.success({ content: t('sys.gaRuntimeMoved') });
    } catch (error) {
      Toast.error({ content: `${t('err.gaRuntimeMove')}: ${String(error)}` });
    }
  };

  return (
    <div className="ga-set-block" data-settings="startup">
      <div className="ga-feature-buttons">
        <Button type="tertiary" onClick={handleConnectSource} disabled={!tauriAvailable}>
          {t('set.gaSource')}
        </Button>
        {gaSource && (
          <Button type="tertiary" onClick={handleClearSource}>
            {t('set.gaSourceClear')}
          </Button>
        )}
        <Button type="tertiary" onClick={handleMoveRuntime} disabled={!tauriAvailable}>
          {t('set.moveGaRuntime')}
        </Button>
      </div>
      {gaSource && <div className="ga-form-locked-hint">{t('set.gaSourceCurrent')}: {gaSource}</div>}
    </div>
  );
}
