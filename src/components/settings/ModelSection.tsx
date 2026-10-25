import { useCallback } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import * as bridge from '../../services/bridge';
import type { ModelProfile } from '../../services/bridge';
import { getProviderIcon, providerFromModel } from '../../data/provider-icons';

function ModelIcon({ model, size = 16 }: { model: string; size?: number }) {
  const key = providerFromModel(model);
  const def = key ? getProviderIcon(key) : undefined;
  if (!def?.Component) return null;
  const Comp = def.Component;
  return <Comp size={size} />;
}

function profileLabel(p: ModelProfile): string {
  return p.name || p.varName || '(unnamed)';
}

interface Props {
  onAdd: () => void;
  onEdit: (id: number) => void;
}

export function ModelSection({ onAdd, onEdit }: Props) {
  const { t } = useI18n();
  const modelProfiles = useSettingsStore((s) => s.modelProfiles);
  const setModelProfiles = useSettingsStore((s) => s.setModelProfiles);

  const mixin = modelProfiles.find((p) => p.kind === 'mixin');

  const handleDelete = useCallback(async (id: number, name: string) => {
    if (!confirm(`${t('common.delete')} "${name}"？`)) return;
    try {
      const profiles = await bridge.deleteModelProfile(id);
      setModelProfiles(profiles);
      Toast.success({ content: t('common.delete') });
    } catch {
      Toast.error({ content: t('err.modelDelete') });
    }
  }, [setModelProfiles, t]);

  const handleAddToMixin = useCallback(async (id: number) => {
    try {
      const profiles = await bridge.addToMixin(id);
      setModelProfiles(profiles);
    } catch {
      Toast.error({ content: t('err.mixinFailed') });
    }
  }, [setModelProfiles, t]);

  const handleRemoveFromMixin = useCallback(async (id: number) => {
    try {
      const profiles = await bridge.removeFromMixin(id);
      setModelProfiles(profiles);
    } catch {
      Toast.error({ content: t('err.mixinFailed') });
    }
  }, [setModelProfiles, t]);

  const handleMoveUp = useCallback(async (memberName: string) => {
    if (!mixin?.members) return;
    const members = [...mixin.members];
    const idx = members.indexOf(memberName);
    if (idx <= 0) return;
    [members[idx - 1], members[idx]] = [members[idx], members[idx - 1]];
    try {
      const profiles = await bridge.reorderMixin(members);
      setModelProfiles(profiles);
    } catch {
      Toast.error({ content: t('err.mixinFailed') });
    }
  }, [mixin, setModelProfiles, t]);

  const handleMoveDown = useCallback(async (memberName: string) => {
    if (!mixin?.members) return;
    const members = [...mixin.members];
    const idx = members.indexOf(memberName);
    if (idx < 0 || idx >= members.length - 1) return;
    [members[idx], members[idx + 1]] = [members[idx + 1], members[idx]];
    try {
      const profiles = await bridge.reorderMixin(members);
      setModelProfiles(profiles);
    } catch {
      Toast.error({ content: t('err.mixinFailed') });
    }
  }, [mixin, setModelProfiles, t]);

  return (
    <div className="ga-set-block">
      <div className="ga-set-sec-t">{t('set.model')}</div>
      <div className="ga-model-list">
        {modelProfiles.length === 0 && (
          <div className="ga-model-empty">{t('set.noModels')}</div>
        )}
        {modelProfiles.map((profile) => (
          <div key={profile.id}>
            <div className="ga-model-item">
              <div className="ga-model-row-content">
                <ModelIcon model={profile.model || ''} />
                <span className="ga-model-name">{profileLabel(profile)}</span>
              </div>
              {profile.kind !== 'mixin' && (
                <span className="ga-model-actions">
                  {mixin && !mixin.members?.includes(profile.name) && (
                    <Button size="small" type="tertiary" theme="borderless"
                      title={profileLabel(mixin)} onClick={() => handleAddToMixin(profile.id)}>+</Button>
                  )}
                  <Button size="small" type="tertiary" theme="borderless" onClick={() => onEdit(profile.id)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="small" type="danger" theme="borderless"
                    onClick={() => handleDelete(profile.id, profileLabel(profile))}>
                    {t('common.delete')}
                  </Button>
                </span>
              )}
            </div>
            {profile.kind === 'mixin' && (
              <details className="ga-mixin-body">
                <summary>{(profile.members || []).join(', ') || t('model.emptyMixin')}</summary>
                <div className="ga-mixin-members">
                  {(profile.members || []).map((memberName, i) => {
                    const memberProfile = modelProfiles.find((p) => p.kind !== 'mixin' && p.name === memberName);
                    return (
                      <div key={`${i}:${memberName}`} className="ga-mixin-member">
                        <span className="ga-mixin-member-rank">{i + 1}</span>
                        <ModelIcon model={memberProfile?.model || ''} size={14} />
                        <span className="ga-mixin-member-name">{memberName}</span>
                        {profile.id === mixin?.id && (
                          <span className="ga-mixin-member-actions">
                            <button type="button" className="ga-icon-btn" disabled={i === 0}
                              onClick={() => handleMoveUp(memberName)} title="↑">↑</button>
                            <button type="button" className="ga-icon-btn" disabled={i === profile.members!.length - 1}
                              onClick={() => handleMoveDown(memberName)} title="↓">↓</button>
                            <button type="button" className="ga-icon-btn ga-icon-btn--danger" disabled={!memberProfile}
                              onClick={() => memberProfile && handleRemoveFromMixin(memberProfile.id)}
                              title={t('model.removeFromMixin')}>×</button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
      <Button type="tertiary" onClick={onAdd} className="ga-add-model-btn">
        + {t('set.addModel')}
      </Button>
    </div>
  );
}
