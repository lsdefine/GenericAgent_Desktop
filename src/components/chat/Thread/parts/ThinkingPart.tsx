import { memo, useState, useRef, useEffect } from 'react';

interface Props {
  content: string;
  isStreaming: boolean;
}

export const ThinkingPart = memo(function ThinkingPart({ content, isStreaming }: Props) {
  const [userPinned, setUserPinned] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const isOpen = userPinned !== null ? userPinned : isStreaming;

  useEffect(() => {
    if (isStreaming && isOpen && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [content, isStreaming, isOpen]);

  if (!content.trim()) return null;

  return (
    <details
      data-slot="aui_thinking-disclosure"
      open={isOpen}
    >
      <summary data-slot="thinking-summary" onClick={(event) => {
        // Native toggle also fires for React-driven open changes. Only pin on activation.
        event.preventDefault();
        setUserPinned(!isOpen);
      }}>
        Thinking
      </summary>
      <div
        ref={bodyRef}
        data-slot="thinking-body"
        data-streaming={isStreaming || undefined}
      >
        {content}
      </div>
    </details>
  );
});
