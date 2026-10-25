import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useStore } from 'zustand';
import { createComposerDraft, type ComposerDraft } from '../../../stores/composerDrafts';
import type { SendOptions } from '../../../stores/chat';
import { RichEditorInput, type RichEditorHandle } from './RichEditorInput';
import { CompletionDrawer } from './CompletionDrawer';
import { AtRefPopover } from './AtRefPopover';
import { ContextMenu } from './ContextMenu';
import { AttachmentStrip, type AttachmentFile } from './AttachmentStrip';
import { SkillPanel } from './SkillPanel';
import { PrimaryCTA, computeCTAState } from './PrimaryCTA';
import { StatusStack } from './StatusStack';
import { usePlaceholder } from './usePlaceholder';
import './composer.css';

interface Props {
  draft?: ComposerDraft;
  onSend: (text: string, opts?: SendOptions) => void | boolean | Promise<void | boolean>;
  onStop: () => void;
  isGenerating: boolean;
  editorRef?: React.RefObject<RichEditorHandle | null>;
  hideStatusStack?: boolean;
  modelSelector?: React.ReactNode;
  extensionsEnabled?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowSendWhileRunning?: boolean;
}

let fileIdCounter = 0;

export function Composer(props: Props) {
  // A supplied placeholder avoids subscribing to the main chat's session state.
  return props.placeholder !== undefined
    ? <ComposerBody {...props} placeholder={props.placeholder} />
    : <ChatPlaceholderComposer {...props} />;
}

function ChatPlaceholderComposer(props: Props) {
  const { text } = usePlaceholder();
  return <ComposerBody {...props} placeholder={text} />;
}

function ComposerBody({ draft: suppliedDraft, onSend, onStop, isGenerating, editorRef: externalEditorRef,
  hideStatusStack, modelSelector, extensionsEnabled = true, placeholder, disabled = false, allowSendWhileRunning = false,
}: Props) {
  const internalEditorRef = useRef<RichEditorHandle>(null);
  const editorRef = (externalEditorRef ?? internalEditorRef) as React.RefObject<RichEditorHandle>;
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [draft] = useState(() => suppliedDraft ?? createComposerDraft());
  const { text: plainText, html, attachments, sending } = useStore(draft);
  const setAttachments = useCallback((update: (prev: AttachmentFile[]) => AttachmentFile[]) => {
    draft.setState((s) => ({ attachments: update(s.attachments) }));
  }, [draft]);

  useLayoutEffect(() => {
    const el = editorRef.current?.getElement();
    // Only our own editor DOM is cached, including skill/reference chips.
    if (!html && !plainText) editorRef.current?.clear();
    else if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html, plainText, editorRef]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      document.documentElement.style.setProperty('--composer-measured-height', `${height}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const processFiles = useCallback((fileList: FileList | File[]) => {
    if (!extensionsEnabled || disabled) return;
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    const newFiles: AttachmentFile[] = [];
    for (const file of Array.from(fileList)) {
      const id = `att-${++fileIdCounter}`;
      const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
      const tooLarge = file.size > MAX_SIZE;
      if (isImage && !tooLarge) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachments((prev) =>
            prev.map((a) => a.id === id ? { ...a, preview: e.target?.result as string, status: 'ready' as const } : a)
          );
        };
        reader.readAsDataURL(file);
      } else if (!isImage && !tooLarge) {
        // Upload file to bridge to get absolute disk path (agent reads via file_read tool)
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const dataUrl = e.target?.result as string;
            const { uploadFile } = await import('../../../services/chat');
            const serverPath = await uploadFile(file.name, dataUrl);
            setAttachments((prev) =>
              prev.map((a) => a.id === id ? { ...a, path: serverPath, status: 'ready' as const, errorMsg: undefined } : a)
            );
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'upload failed';
            setAttachments((prev) =>
              prev.map((a) => a.id === id ? { ...a, status: 'error' as const, errorMsg } : a)
            );
          }
        };
        reader.onerror = () => {
          setAttachments((prev) =>
            prev.map((a) => a.id === id ? { ...a, status: 'error' as const, errorMsg: 'read failed' } : a)
          );
        };
        reader.readAsDataURL(file);
      }
      newFiles.push({
        id,
        name: file.name,
        size: file.size,
        type: isImage ? 'image' : 'file',
        status: tooLarge ? 'error' : 'uploading',
        errorMsg: tooLarge ? 'File too large (max 50 MB)' : undefined,
        path: (file as File & { path?: string }).path || file.name,
      });
    }
    setAttachments((prev) => [...prev, ...newFiles]);
  }, [extensionsEnabled, disabled, setAttachments]);

  const handleSend = useCallback(async () => {
    if (disabled || draft.getState().sending || (isGenerating && !allowSendWhileRunning)) return;
    const text = plainText.trim();
    if (!text && attachments.length === 0) return;
    const readyImages = attachments.filter((a) => a.type === 'image' && a.status === 'ready');
    const pendingImages = attachments.filter((a) => a.type === 'image' && a.status === 'uploading');
    const pendingFiles = attachments.filter((a) => a.type === 'file' && a.status === 'uploading');
    const errorFiles = attachments.filter((a) => a.status === 'error');
    if (pendingImages.length > 0 || pendingFiles.length > 0 || errorFiles.length > 0) return;
    const opts: SendOptions = {};
    const files = attachments.filter((a) => a.type === 'file');
    if (files.length > 0) {
      opts.files = files.map((f) => ({ name: f.name, path: f.path || f.name, size: f.size }));
    }
    if (readyImages.length > 0) {
      opts.images = readyImages.map((f) => ({ name: f.name, path: f.path || f.name, base64: f.preview! }));
    }
    draft.setState({ sending: true });
    try {
      const accepted = await onSend(text || '', Object.keys(opts).length > 0 ? opts : undefined);
      if (accepted === false) return;
      draft.setState({ text: '', html: '', attachments: [] });
    } finally {
      draft.setState({ sending: false });
    }
  }, [plainText, attachments, onSend, disabled, isGenerating, allowSendWhileRunning, draft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleEditorInput = useCallback((text: string) => {
    draft.setState({ text, html: editorRef.current?.getElement()?.innerHTML ?? '' });
  }, [draft, editorRef]);

  const handleSlashTrigger = useCallback((query: string) => {
    setSlashQuery(query);
  }, []);

  const handleSlashDismiss = useCallback(() => {
    setSlashQuery(null);
  }, []);

  const handleCompletionSelect = useCallback((id: string, prompt: string) => {
    editorRef.current?.setSkillChip(id, prompt);
    editorRef.current?.focus();
    setSlashQuery(null);
  }, []);

  const handleAtTrigger = useCallback((query: string) => {
    setAtQuery(query);
  }, []);

  const handleAtDismiss = useCallback(() => {
    setAtQuery(null);
  }, []);

  const handleAtConfirm = useCallback((kind: string, value: string) => {
    // Remove the `@query` text from editor, then insert chip
    const currentText = editorRef.current?.getText() || '';
    const atIdx = currentText.lastIndexOf('@');
    if (atIdx >= 0) {
      editorRef.current?.setText(currentText.slice(0, atIdx));
    }
    editorRef.current?.insertChip(kind, value);
    editorRef.current?.focus();
    setAtQuery(null);
  }, []);

  const handlePasteFiles = useCallback((files: File[]) => {
    processFiles(files);
  }, [processFiles]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSkillSelect = useCallback((id: string, prompt: string) => {
    editorRef.current?.setSkillChip(id, prompt);
    editorRef.current?.focus();
  }, []);

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'clipboard-image.png', { type: imageType });
          processFiles([file]);
          return;
        }
      }
    } catch { /* clipboard permission denied — silently ignore */ }
  }, [processFiles]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (extensionsEnabled && !disabled) setIsDragOver(true);
  }, [extensionsEnabled, disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const hasContent = plainText.trim().length > 0 || attachments.length > 0;
  const hasPendingUploads = attachments.some((a) => a.status === 'uploading');
  const ctaState = disabled || sending ? 'disabled' : computeCTAState(isGenerating && !(allowSendWhileRunning && hasContent), hasContent, hasPendingUploads);

  return (
    <div
      ref={composerRef}
      data-slot="composer-root"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPasteCapture={(event) => {
        if (!extensionsEnabled && (event.clipboardData.files.length > 0 ||
            Array.from(event.clipboardData.items).some((item) => item.kind === 'file'))) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {isDragOver && <div data-slot="composer-drop-overlay">Drop files here</div>}
      <div data-slot="composer-surface">
        {extensionsEnabled && !hideStatusStack && <StatusStack />}
        {extensionsEnabled && <>
        <AttachmentStrip files={attachments} onRemove={handleRemoveAttachment} />
        <CompletionDrawer
          visible={slashQuery !== null}
          query={slashQuery || ''}
          onSelect={handleCompletionSelect}
          onClose={handleSlashDismiss}
        />
        <AtRefPopover
          visible={atQuery !== null}
          query={atQuery || ''}
          onConfirm={handleAtConfirm}
          onClose={handleAtDismiss}
        />
        </>}
        <div data-slot="composer-input-row">
          <RichEditorInput
            ref={editorRef}
            placeholder={placeholder ?? ""}
            disabled={disabled || sending}
            onInput={handleEditorInput}
            onKeyDown={handleKeyDown}
            onSlashTrigger={extensionsEnabled ? handleSlashTrigger : undefined}
            onSlashDismiss={handleSlashDismiss}
            onAtTrigger={extensionsEnabled ? handleAtTrigger : undefined}
            onAtDismiss={handleAtDismiss}
            onPasteFiles={extensionsEnabled ? handlePasteFiles : undefined}
          />
        </div>
        <div data-slot="composer-toolbar">
          <div data-slot="composer-toolbar-left">
            {extensionsEnabled && <>
            <ContextMenu
              onUploadFile={handleFileClick}
              onUploadImage={handleImageClick}
              onPasteImage={handlePasteFromClipboard}
            />
            <SkillPanel onSelect={handleSkillSelect} />
            </>}
          </div>
          <div data-slot="composer-toolbar-right">
            {modelSelector}
            <PrimaryCTA state={ctaState} onSend={handleSend} onStop={onStop} />
          </div>
        </div>
      </div>
      {extensionsEnabled && <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      </>}
    </div>
  );
}
