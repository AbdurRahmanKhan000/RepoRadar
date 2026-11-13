// Evidence drawer — Build 4 (spec §8.2, item 7; FR-08).
// Opens from a category row and shows, for every signal in that
// category, the exact value, the source endpoint, the observed-at
// time, the formula, and any limitation. Closes via the close
// button, Escape, or the backdrop; focus returns to the row that
// opened it. The drawer is a dialog, not a navigation — the panel
// underneath stays mounted.

import { useEffect, useRef } from 'react';

import { SIGNAL_SOURCES } from '../../src/analysis/scoring';
import type { CategoryScore } from '../../src/domain/report';
import type { EvidenceItem } from '../../src/domain/repository';
import { formulaFor } from '../../src/shared/signal-formulas';

function formatValue(value: number | string | boolean | null): string {
  if (value === null) return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return value;
}

function formatObservedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface EvidenceDrawerProps {
  category: CategoryScore;
  /** Full evidence list (overview + signal items) for observedAt. */
  evidence: EvidenceItem[];
  onClose: () => void;
}

export function EvidenceDrawer({ category, evidence, onClose }: EvidenceDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const statusNote =
    category.status === 'available'
      ? 'All signals in this category were scored.'
      : category.status === 'partial'
        ? 'Some signals in this category could not be scored — missing data lowered coverage instead of scoring 0.'
        : 'No signal in this category could be scored — not enough data.';

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Evidence for ${category.label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <h2>{category.label}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label={`Close evidence for ${category.label}`}
          >
            ✕
          </button>
        </div>
        <p className="drawer-score">
          Score: <strong>{category.score === null ? 'Not scored' : `${category.score} / 100`}</strong>
          {' · '}Weight in overall score: {Math.round(category.weight * 100)}%
        </p>
        <p className="muted small">{statusNote}</p>

        <ul className="drawer-signals">
          {category.signals.map((signal) => {
            const item = evidence.find((e) => e.key === `signal:${signal.key}`);
            return (
              <li key={signal.key} className="drawer-signal">
                <div className="drawer-signal-head">
                  <span className="drawer-signal-label">{signal.label}</span>
                  <span className="drawer-signal-score">
                    {signal.score === null ? 'Not scored' : `${signal.score} / 100`}
                  </span>
                </div>
                <p className="drawer-signal-detail">{signal.detail}</p>
                <dl className="drawer-evidence">
                  <div>
                    <dt>Value</dt>
                    <dd>{formatValue(signal.value)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{SIGNAL_SOURCES[signal.key] ?? 'Unknown source'}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{item ? formatObservedAt(item.observedAt) : 'Unknown'}</dd>
                  </div>
                  {item?.window && (
                    <div>
                      <dt>Window</dt>
                      <dd>{item.window}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Formula</dt>
                    <dd>{formulaFor(signal.key)}</dd>
                  </div>
                  {item?.limitation && (
                    <div>
                      <dt>Limitation</dt>
                      <dd>{item.limitation}</dd>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          A score is an evidence-based heuristic, not proof of code quality or safety.
        </p>
      </aside>
    </div>
  );
}
