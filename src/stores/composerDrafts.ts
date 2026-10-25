import { createStore } from 'zustand/vanilla';
import type { AttachmentFile } from '../components/chat/Composer/AttachmentStrip';

export const createComposerDraft = () => createStore(() => ({
  text: '', html: '', attachments: [] as AttachmentFile[], sending: false,
}));
export type ComposerDraft = ReturnType<typeof createComposerDraft>;

// Memory only; null is the not-yet-created conversation.
const drafts = new Map<string | null, ComposerDraft>();
export function getComposerDraft(id: string | null): ComposerDraft {
  if (!drafts.has(id)) drafts.set(id, createComposerDraft());
  return drafts.get(id)!;
}
export function adoptComposerDraft(id: string): void {
  drafts.set(id, getComposerDraft(null));
  drafts.delete(null);
}
export function deleteComposerDraft(id: string): void {
  drafts.delete(id);
}
