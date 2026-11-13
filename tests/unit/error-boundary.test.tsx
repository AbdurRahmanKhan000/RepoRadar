// @vitest-environment jsdom
// Error boundary — Build 6 hardening.
// A render crash in the side panel or popup must show a friendly
// fallback with a Try again action, never a blank surface.
//
// The boundary is tested with client rendering (createRoot + act):
// React's server renderers do not reliably honour error boundaries
// for a synchronously throwing child (verified: both renderToString
// and renderToPipeableStream propagate the throw in React 19),
// while the browser — where the boundary actually runs — catches it.
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ErrorBoundary } from '../../src/shared/ErrorBoundary';

// React 19 requires this flag for act() outside a test runner
// integration.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error('boom');
}

function renderClient(element: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    act(() => {
      root.render(element);
    });
  } finally {
    errorSpy.mockRestore();
  }
  return { container, root };
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    const { container, root } = renderClient(
      <ErrorBoundary surface="side panel">
        <p>hello</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('hello');
    expect(container.textContent).not.toContain('Something went wrong');
    act(() => root.unmount());
    container.remove();
  });

  it('shows a friendly fallback with Try again when a child throws', () => {
    const { container, root } = renderClient(
      <ErrorBoundary surface="side panel">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('side panel');
    expect(container.querySelector('button')?.textContent).toBe('Try again');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('names the surface it guards', () => {
    const { container, root } = renderClient(
      <ErrorBoundary surface="popup">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('popup');
    act(() => root.unmount());
    container.remove();
  });

  it('getDerivedStateFromError switches to the error state', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });
});
