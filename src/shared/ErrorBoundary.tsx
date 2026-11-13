// React error boundary — Build 6 hardening (spec §13, Build 6).
// A render crash in the side panel or popup used to mean a blank
// surface with no way back. The boundary catches render errors and
// shows a friendly message plus a Try again action (a plain reload)
// instead. It never touches storage: saved repositories, the theme
// choice and the cache are untouched by a UI crash, and the reload
// re-renders from the same cached data.
// The boundary only wraps UI entrypoints; it is not a substitute
// for the service-level error handling in repository-service.ts
// (API failures still produce the panel's own error states).

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Where the crash happened — shown in the fallback heading. */
  surface: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  // React passes the error in; the fallback deliberately does not
  // display it (raw internals are not user-facing — componentDidCatch
  // logs it for diagnosis instead).
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged for diagnosis only. No repo content, token, or user
    // data is ever attached to an error log.
    console.error(`[RepoRadar] ${this.props.surface} crashed:`, error, info.componentStack);
  }

  private retry = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="error-boundary" role="alert">
          <h1>Something went wrong</h1>
          <p>
            RepoRadar hit an unexpected error while drawing the {this.props.surface}. Your saved
            repositories and settings are untouched.
          </p>
          <button type="button" className="primary" onClick={this.retry}>
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
