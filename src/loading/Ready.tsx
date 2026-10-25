import { useEffect } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { t } from './i18n';

export function ReadyScreen() {
  useEffect(() => {
    let disposed = false;
    const invoke = (window as any).__TAURI__?.core?.invoke;

    const navigateToApp = () => {
      if (!disposed) {
        window.location.href = '/index.html';
      }
    };

    const askForShortcut = async () => {
      if (!invoke) {
        navigateToApp();
        return;
      }

      try {
        const shouldAsk = await invoke('shortcut_should_ask');
        if (disposed) return;
        if (!shouldAsk) {
          navigateToApp();
          return;
        }

        await new Promise<void>((resolve) => {
          let decided = false;
          const decide = async (create: boolean) => {
            if (decided || disposed) {
              resolve();
              return;
            }
            decided = true;
            try {
              await invoke('shortcut_decide', { create });
            } finally {
              resolve();
            }
          };

          Modal.confirm({
            title: t('shortcut.askConfirm'),
            content: t('shortcut.askConfirm'),
            onOk: () => decide(true),
            onCancel: () => decide(false),
          });
        });
        navigateToApp();
      } catch {
        navigateToApp();
      }
    };

    void askForShortcut();
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className="bs-screen bs-ready">
      <div className="bs-check" aria-hidden="true">&#10003;</div>
      <p className="bs-text">{t('ready')}</p>
      <p className="bs-subtext">{t('readyDetail')}</p>
    </div>
  );
}
