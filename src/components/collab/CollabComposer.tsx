import { useCallback } from 'react';
import { useConductorStore } from '../../stores/conductor';
import { Composer } from '../chat/Composer';
import { ConductorModelSelector } from './ConductorModelSelector';

export function CollabComposer() {
  const sendMessage = useConductorStore((s) => s.sendMessage);
  const conductorTyping = useConductorStore((s) => s.conductorTyping);
  const connectionStatus = useConductorStore((s) => s.connectionStatus);

  const handleSend = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  const disabled = connectionStatus !== 'ready';

  return (
    <div className="collab-composer-wrap" data-slot="collab-composer" data-disabled={disabled || undefined}>
      <Composer
        onSend={handleSend}
        isGenerating={conductorTyping}
        onStop={() => {}}
        allowSendWhileRunning
        extensionsEnabled={false}
        hideStatusStack
        disabled={disabled}
        placeholder="把要完成的事告诉指挥家…"
        modelSelector={<ConductorModelSelector />}
      />
    </div>
  );
}
