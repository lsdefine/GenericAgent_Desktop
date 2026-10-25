import { useConductorStore } from '../../stores/conductor';

/** Model data and actions belong exclusively to the conductor WebSocket. */
export function ConductorModelSelector() {
  const models = useConductorStore((s) => s.models);
  const selected = useConductorStore((s) => s.selectedModel);
  const pending = useConductorStore((s) => s.pendingModel);
  const error = useConductorStore((s) => s.modelError);
  const connected = useConductorStore((s) => s.connectionStatus === 'ready');
  const selectModel = useConductorStore((s) => s.selectModel);

  return (
    <div className="conductor-model-selector" data-slot="conductor-model-selector">
      <select
        aria-label="指挥家模型"
        title="由指挥家确认模型选择；下一次任务生效，不改变正在执行的任务"
        value={selected ?? ''}
        disabled={!connected || selected === null || pending !== null}
        onChange={(event) => selectModel(Number(event.target.value))}
      >
        {selected === null && <option value="">{connected ? '同步模型列表…' : '指挥家未连接'}</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      {pending !== null && <span role="status">等待指挥家确认…</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
