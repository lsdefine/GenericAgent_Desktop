import { Button, Toast } from '@douyinfe/semi-ui';
import * as bridge from '../../services/bridge';
import { isTauri, pickDirectory, exportMykey, tauriInvoke } from '../../utils/tauri';
import { useI18n } from '../../i18n';

export function RuntimeFeatures() {
  const { t } = useI18n();
  const tauriAvailable = isTauri();
  const handleImportMemory = async () => {
    try {
      const sourceDir = await pickDirectory(t('sys.memoryPickTitle'));
      if (!sourceDir) return;

      const result = await bridge.importMemory(sourceDir);
      if (result.ok === false) {
        throw new Error(String(result.error || 'import failed'));
      }

      const details = t('sys.memoryImportedDetail', {
        memory: Number(result.memoryCopied || 0),
        responses: Number(result.responsesCopied || 0),
        sessions: Number(result.sessionsAdded || 0),
      });
      Toast.success({ content: details });
    } catch (error) {
      Toast.error({ content: `${t('err.memoryImport')}: ${String(error)}` });
    }
  };

  const handleImportMykey = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await bridge.saveMykeyContent(await file.text());
        Toast.success({ content: t('sys.mykeyImported') });
      } catch {
        Toast.error({ content: t('err.mykeyImport') });
      }
    };
    input.click();
  };

  const handleExportMykey = async () => {
    try {
      const content = await bridge.getMykeyContent();
      const path = await exportMykey(content);
      if (path) {
        Toast.success({ content: t('sys.mykeyExported') });
      }
    } catch {
      Toast.error({ content: t('err.mykeyExport') });
    }
  };

  const handleOpenServices = () => {
    window.dispatchEvent(new CustomEvent('ga:go-page', { detail: { page: 'services' } }));
    window.dispatchEvent(new Event('ga:close-settings'));
  };

  return (
    <div className="ga-set-block">
      <div className="ga-set-sec-t">{t('set.features')}</div>
      <div className="ga-feature-buttons">
        <Button type="tertiary" onClick={handleImportMykey}>
          {t('set.importMykey')}
        </Button>
        <Button type="tertiary" onClick={handleExportMykey} disabled={!tauriAvailable}>
          {t('set.exportMykey')}
        </Button>
      <Button type="tertiary" disabled={!tauriAvailable} onClick={() =>
        tauriInvoke('edit_mykey').catch((e) => Toast.error({ content: String(e) }))}>
        {t('set.editMykey')}</Button>
        <Button type="tertiary" onClick={handleImportMemory} disabled={!tauriAvailable}>
          {t('set.importMemory')}
        </Button>
        <Button type="tertiary" onClick={handleOpenServices}>{t('set.serviceManager')}</Button>
      </div>
    </div>
  );
}
