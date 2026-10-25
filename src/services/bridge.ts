import { BRIDGE_BASE } from './constants';

export interface AppConfig {
  lang: 'zh' | 'en';
  theme: string;
  appearance: 'light' | 'dark';
  plain: boolean;
  fontSize: number;
}

export interface ModelProfile {
  id: number;
  varName?: string;
  name: string;
  model: string;
  apibase: string;
  apikey?: string;
  protocol: 'oai' | 'claude';
  stream: boolean;
  max_retries?: number;
  connect_timeout?: number;
  read_timeout?: number;
  kind?: 'mixin';
  members?: string[];
  inMixin?: boolean;
}

export async function bridgeFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${BRIDGE_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.ok === false) throw new Error(data.error || 'Bridge request failed');
  return data;
}

export async function getConfig(): Promise<AppConfig> {
  const res = await bridgeFetch('/config') as { config: AppConfig };
  return res.config;
}

export async function saveConfig(config: Partial<AppConfig>): Promise<void> {
  await bridgeFetch('/config', { method: 'POST', body: JSON.stringify({ config }) });
}

export async function getModelProfiles(): Promise<ModelProfile[]> {
  try {
    const res = await bridgeFetch('/model-profiles') as { profiles: ModelProfile[] };
    return res.profiles || [];
  } catch {
    return [];
  }
}

export async function getModelProfileDetail(id: number): Promise<ModelProfile | null> {
  try {
    const res = await bridgeFetch(`/model-profiles/${id}`) as { profile: ModelProfile };
    return res.profile || null;
  } catch {
    return null;
  }
}

export async function addModelProfile(data: Partial<ModelProfile>): Promise<ModelProfile[]> {
  const res = await bridgeFetch('/model-profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function editModelProfile(id: number, data: Partial<ModelProfile>): Promise<ModelProfile[]> {
  const res = await bridgeFetch(`/model-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function deleteModelProfile(id: number): Promise<ModelProfile[]> {
  const res = await bridgeFetch(`/model-profiles/${id}`, {
    method: 'DELETE',
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function addToMixin(id: number): Promise<ModelProfile[]> {
  const res = await bridgeFetch(`/model-profiles/${id}/mixin`, {
    method: 'POST',
    body: '{}',
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function removeFromMixin(id: number): Promise<ModelProfile[]> {
  const res = await bridgeFetch(`/model-profiles/${id}/mixin`, {
    method: 'DELETE',
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function reorderMixin(members: string[]): Promise<ModelProfile[]> {
  const res = await bridgeFetch('/model-profiles/mixin/order', {
    method: 'PUT',
    body: JSON.stringify({ members }),
  }) as { profiles: ModelProfile[] };
  return res.profiles;
}

export async function getMykeyContent(): Promise<string> {
  const res = await bridgeFetch('/services/mykey') as { content: string };
  return res.content;
}

export async function saveMykeyContent(content: string): Promise<void> {
  await bridgeFetch('/services/mykey', { method: 'POST', body: JSON.stringify({ content }) });
}

export async function importMemory(sourceDir: string): Promise<Record<string, unknown>> {
  return await bridgeFetch('/memory/import', { method: 'POST', body: JSON.stringify({ sourceDir }) }) as Record<string, unknown>;
}
