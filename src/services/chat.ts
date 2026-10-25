import { bridgeFetch } from './bridge';

export type MessageStatus = 'completed' | 'in_progress' | 'failed';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  status: MessageStatus;
  createdAt?: number;
  ts?: number;
  turn_segs?: string[];
  images?: { name: string; path: string }[];
  files?: { name: string; path: string; size?: number }[];
}

export interface SessionInfo {
  loaded?: boolean;
  id: string;
  title: string;
  untitled: boolean;
  pinned?: boolean;
  updatedAt?: number | string;
  createdAt?: number | string;
}

export interface SessionModel {
  isMixin: boolean;
  current: string | null;
  llmNo?: number | null;
}

export interface PollResult {
  messages: Message[];
  partial?: Message;
  status: 'running' | 'idle';
  plan?: unknown;
  model?: SessionModel;
}

function normalizeMessage(msg: Record<string, unknown>, status: MessageStatus = 'completed'): Message {
  const m: Message = {
    id: String(msg.id),
    role: msg.role as Message['role'],
    content: (msg.content as string) || '',
    status: (msg.status as MessageStatus) ?? status,
    createdAt: (msg.createdAt as number) ??
      (typeof msg.ts === 'number' ? msg.ts * 1000 : undefined),
  };
  if (Array.isArray(msg.turn_segs)) {
    m.turn_segs = msg.turn_segs as string[];
  }
  if (Array.isArray(msg.images) && msg.images.length > 0) {
    m.images = msg.images as { name: string; path: string }[];
  }
  if (Array.isArray(msg.files) && msg.files.length > 0) {
    m.files = msg.files as { name: string; path: string; size?: number }[];
  }
  return m;
}


export async function createSession(): Promise<string> {
  const data = await bridgeFetch(`/session/new`, {
    method: 'POST',
    body: JSON.stringify({ cwd: '', mcp_servers: [] }),
  });
  return data.sessionId;
}

async function uploadImage(sessionId: string, name: string, dataUrl: string): Promise<string> {
  const data = await bridgeFetch(`/upload`, {
    method: 'POST',
    body: JSON.stringify({ name, dataUrl, sid: sessionId }),
  });
  if (!data.ok) throw new Error(data.error || 'upload failed');
  return data.path;
}

export function uploadFile(name: string, dataUrl: string): Promise<string> {
  return uploadImage('_files', name, dataUrl);
}

export async function setSessionModel(sessionId: string, llmNo: number): Promise<SessionModel> {
  const data = await bridgeFetch(`/session/${sessionId}/model`, {
    method: 'POST', body: JSON.stringify({ llmNo }),
  });
  return data.model;
}

export async function sendPrompt(
  sessionId: string,
  prompt: string,
  files?: { name: string; path: string; size?: number }[],
  images?: { name: string; path: string; base64?: string }[],
): Promise<string> {

  const filesMeta = (files || []).map((f) => ({ name: f.name, path: f.path, size: f.size }));

  // Upload images that only have base64 (pasted/dropped) to get file paths
  const imageMetas: { name: string; path: string }[] = [];
  for (const img of images || []) {
    const hasRealPath = img.path && !img.path.startsWith('data:') && img.path !== img.name;
    if (hasRealPath) {
      imageMetas.push({ name: img.name, path: img.path });
    } else {
      const dataUrl = img.base64 || (img.path?.startsWith('data:') ? img.path : undefined);
      if (dataUrl) {
        const path = await uploadImage(sessionId, img.name, dataUrl);
        imageMetas.push({ name: img.name, path });
      }
    }
  }

  const data = await bridgeFetch(`/session/${sessionId}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, prompt, display: prompt, files: filesMeta, imageMetas }),
  });
  return data.userMessageId;
}

export async function pollMessages(
  sessionId: string,
  afterId?: string,
  limit: number = 50,
): Promise<PollResult> {

  const params = new URLSearchParams({ limit: String(limit) });
  if (afterId) params.set('after', afterId);
  const data = await bridgeFetch(`/session/${sessionId}/messages?${params}`);
  return {
    messages: (data.messages || []).map((m: Record<string, unknown>) => normalizeMessage(m)),
    partial: data.partial ? normalizeMessage(data.partial, 'in_progress') : undefined,
    status: data.status,
    plan: data.plan,
    model: data.model,
  };
}

export async function cancelGeneration(sessionId: string): Promise<void> {
  await bridgeFetch(`/session/${sessionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function listSessions(): Promise<SessionInfo[]> {
  const data = await bridgeFetch(`/sessions`);
  // Session visibility belongs to bridge, not an inferred agent ID convention.
  return data.sessions || [];
}

export async function deleteSession(sessionId: string): Promise<void> {
  await bridgeFetch(`/session/${sessionId}`, { method: 'DELETE' });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await bridgeFetch(`/session/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  await bridgeFetch(`/session/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned }),
  });
}

export async function restoreSession(sessionId: string): Promise<void> {
  const result = await bridgeFetch(`/session/${sessionId}/restore`, { method: 'POST' });
  if (!result.ok) throw new Error(result.error || 'Session restore failed');
}
