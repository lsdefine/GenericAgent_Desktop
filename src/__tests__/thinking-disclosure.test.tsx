import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThinkingPart } from '../components/chat/Thread/parts/ThinkingPart';

afterEach(cleanup);

it('does not treat a native toggle notification as a user preference', () => {
  const view = render(<ThinkingPart content="one" isStreaming />);
  const details = view.container.querySelector('details')!;
  fireEvent(details, new Event('toggle'));
  expect(details.open).toBe(true);
  view.rerender(<ThinkingPart content="done" isStreaming={false} />);
  fireEvent(details, new Event('toggle'));
  expect(details.open).toBe(false);
});

it('keeps the user choice across text updates and stream completion', () => {
  const view = render(<ThinkingPart content="one" isStreaming />);
  const details = view.container.querySelector('details')!;
  const summary = details.querySelector('summary')!;
  fireEvent.click(summary);
  view.rerender(<ThinkingPart content="two" isStreaming />);
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  view.rerender(<ThinkingPart content="done" isStreaming={false} />);
  expect(details.open).toBe(true);
});
