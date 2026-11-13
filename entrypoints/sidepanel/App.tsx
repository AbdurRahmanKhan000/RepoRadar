import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import type { ActivityData } from '../../src/domain/activity';
import { gradeLabel } from '../../src/analysis/scoring';
import type { ConnectionProbeResult } from '../../src/diagnostics/connection';
import type { CategoryScore, RepositoryReport } from '../../src/domain/report';
import type { OverviewResult, ProviderErrorData } from '../../src/domain/repository';
import { resetInLabel } from '../../src/api/rate-limit';
import { APP_VERSION } from '../../src/shared/constants';
import { isRefreshDisabled, tryAgainForceRefresh } from '../../src/shared/rate-limit-ui';
import { buildCompareRows, canAddToCompare, type CompareEntry } from '../../src/compare/compare';
import { compareExportFilename, downloadFile, exportFilename } from '../../src/export/download';
import { toReportJson } from '../../src/export/json';
import { compareToMarkdown, reportToMarkdown } from '../../src/export/markdown';
import { repoUrl } from '../../src/shared/repo-url';
import { useTheme } from '../../src/shared/theme';
import {
  MAX_SAVED_REPOS,
  SAVED_REPOS_STORAGE_KEY,
  SavedReposStore,
  type SavedRepoEntry,
} from '../../src/storage/saved-repos';
import {
  LAST_REPO_STORAGE_KEY,
  type LastRepoRecord,
} from '../../src/messaging/messages';
import { EvidenceDrawer } from './EvidenceDrawer';
import './App.css';

// Charts are lazy-loaded so the Recharts bundle does not weigh down
// the panel's first paint; a skeleton shows until the chunk arrives.
const ScoreGauge = lazy(() => import('./charts').then((m) => ({ default: m.ScoreGauge })));
const ActivityChart = lazy(() => import('./charts').then((m) => ({ default: m.ActivityChart })));
const LanguageDonut = lazy(() => import('./charts').then((m) => ({ default: m.LanguageDonut })));

type PanelState =
  | { status: 'idle' }
  | { status: 'loading'; repo: LastRepoRecord }
  | { status: 'ready'; overview: OverviewResult; report: RepositoryReport; activity: ActivityData }
  | { status: 'error'; repo: LastRepoRecord; error: ProviderErrorData; rateLimitReset: string | null };

type CompareViewState =
  | { status: 'loading' }
  | { status: 'ready'; entries: CompareEntry[] }
  | { status: 'error'; message: string };

/** chrome.storage.local behind the KeyValueStore interface the
 *  SavedReposStore expects. */
const chromeLocalStore = {
  get: (key: string) => browser.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

function formatCompareValue(rowKey: string, value: number | string | null): string {
  if (value === null) return '—';
  if (rowKey === 'coverage' || rowKey === 'issueClosure') return `${value}%`;
  return String(value);
}

function confidenceLabel(confidence: RepositoryReport['confidence']): string {
  return confidence === 'high' ? 'High confidence' : confidence === 'medium' ? 'Medium confidence' : 'Low confidence';
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function errorGuidance(error: ProviderErrorData): string {
  switch (error.code) {
    case 'NOT_FOUND':
      return 'Check the owner and repository name — this repository does not exist on GitHub, or it is private.';
    case 'RATE_LIMITED':
      return 'Unauthenticated GitHub requests are limited to 60 per hour. Wait for the window to reset, or refresh to use cached data.';
    case 'NETWORK_ERROR':
      return 'RepoRadar could not reach api.github.com. Check your connection, then refresh.';
    case 'FORBIDDEN':
      return 'GitHub refused this request. The repository may be unavailable to unauthenticated requests.';
    case 'UNSUPPORTED_PLATFORM':
      return error.message;
    default:
      return 'RepoRadar could not load this repository. Try refreshing.';
  }
}

function categoryStatusNote(category: CategoryScore): string {
  if (category.status === 'partial') return 'partial data';
  if (category.status === 'unknown') return 'not enough data';
  return 'complete';
}

function App() {
  const { resolved: theme, toggle: toggleTheme } = useTheme();
  const [lastRepo, setLastRepo] = useState<LastRepoRecord | null>(null);
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const [drawerCategory, setDrawerCategory] = useState<CategoryScore | null>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Build 5 — save / compare / export.
  const savedStoreRef = useRef<SavedReposStore | null>(null);
  if (!savedStoreRef.current) savedStoreRef.current = new SavedReposStore(chromeLocalStore);
  const [savedRepos, setSavedRepos] = useState<SavedRepoEntry[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [compareLimitMessage, setCompareLimitMessage] = useState<string | null>(null);
  const [compareView, setCompareView] = useState<CompareViewState | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  // Fixes 0.2.1 — connection diagnostics on the error card.
  const [connTest, setConnTest] = useState<{
    status: 'idle' | 'loading' | 'done';
    results: ConnectionProbeResult[] | null;
  }>({ status: 'idle', results: null });
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const analyze = useCallback((repo: LastRepoRecord, forceRefresh = false) => {
    setState({ status: 'loading', repo });
    setConnTest({ status: 'idle', results: null });
    setDiagnosticsCopied(false);
    void browser.runtime
      .sendMessage({ type: 'ANALYZE_REPOSITORY', owner: repo.owner, repo: repo.repo, forceRefresh })
      .then((response: unknown) => {
        const res = response as
          | { type: 'ANALYSIS_COMPLETE'; overview: OverviewResult; report: RepositoryReport; activity: ActivityData }
          | { type: 'ANALYSIS_ERROR'; code: ProviderErrorData['code']; message: string; detail?: string | null }
          | undefined;
        if (!res) {
          setState({
            status: 'error',
            repo,
            error: { code: 'UNKNOWN', message: 'No response from the background worker.', status: null, detail: null },
            rateLimitReset: null,
          });
          return;
        }
        if (res.type === 'ANALYSIS_COMPLETE') {
          setState({ status: 'ready', overview: res.overview, report: res.report, activity: res.activity });
        } else {
          setState({
            status: 'error',
            repo,
            error: { code: res.code, message: res.message, status: null, detail: res.detail ?? null },
            rateLimitReset: null,
          });
        }
      })
      .catch(() => {
        setState({
          status: 'error',
          repo,
          error: { code: 'UNKNOWN', message: 'Could not reach the background worker.', status: null, detail: null },
          rateLimitReset: null,
        });
      });
  }, []);

  /** Probe api.github.com + github.com from the background worker
   *  and show the raw outcome per host. A blocked API host shows
   *  up here as "api.github.com: unreachable" while github.com
   *  answers — that is the difference between a blocked host and
   *  a dead connection. */
  const runConnectionTest = useCallback(() => {
    setConnTest({ status: 'loading', results: null });
    void browser.runtime
      .sendMessage({ type: 'TEST_CONNECTION' })
      .then((response: unknown) => {
        const res = response as
          | { type: 'TEST_CONNECTION_RESULT'; results: ConnectionProbeResult[] }
          | undefined;
        setConnTest({
          status: 'done',
          results: res?.type === 'TEST_CONNECTION_RESULT' ? res.results : null,
        });
      })
      .catch(() => setConnTest({ status: 'done', results: null }));
  }, []);

  /** Copy a diagnostics packet for support: repo, error, raw
   *  detail, time, extension version. No tokens or personal data. */
  const copyDiagnostics = useCallback(() => {
    if (state.status !== 'error') return;
    const packet = {
      repo: `${state.repo.owner}/${state.repo.repo}`,
      code: state.error.code,
      message: state.error.message,
      detail: state.error.detail,
      time: new Date().toISOString(),
      extensionVersion: APP_VERSION,
    };
    const text = JSON.stringify(packet, null, 2);
    const done = () => setDiagnosticsCopied(true);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }, [state]);

  function fallbackCopy(text: string, done: () => void): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      // Clipboard unavailable; the detail line above already shows it.
    } finally {
      area.remove();
    }
  }

  useEffect(() => {
    void browser.storage.local.get(LAST_REPO_STORAGE_KEY).then((result) => {
      const record = result[LAST_REPO_STORAGE_KEY] as LastRepoRecord | undefined;
      if (record) {
        setLastRepo(record);
        analyze(record);
      }
    });
    void savedStoreRef.current?.load().then(setSavedRepos).catch(() => undefined);
    const onStorage = (changes: Record<string, { newValue?: unknown }>) => {
      const change = changes[LAST_REPO_STORAGE_KEY];
      if (change?.newValue) {
        const record = change.newValue as LastRepoRecord;
        setLastRepo(record);
        analyze(record);
      }
      const savedChange = changes[SAVED_REPOS_STORAGE_KEY];
      if (savedChange) {
        void savedStoreRef.current?.load().then(setSavedRepos).catch(() => undefined);
      }
    };
    browser.storage.onChanged.addListener(onStorage);
    return () => browser.storage.onChanged.removeListener(onStorage);
  }, [analyze]);

  const openDrawer = useCallback((category: CategoryScore, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger;
    setDrawerCategory(category);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerCategory(null);
    drawerTriggerRef.current?.focus();
  }, []);

  const overview = state.status === 'ready' ? state.overview : null;
  const report = state.status === 'ready' ? state.report : null;
  const activity = state.status === 'ready' ? state.activity : null;
  const facts = overview?.facts ?? null;

  // Refresh forces a live request, so it is disabled while the rate
  // limit is exhausted (or the last load failed on it). "Try again"
  // below is cache-first in that case instead.
  const refreshDisabled = isRefreshDisabled({
    loading: state.status === 'loading',
    rateLimit: overview?.rateLimit ?? null,
    lastErrorCode: state.status === 'error' ? state.error.code : null,
  });
  const refreshTitle = refreshDisabled
    ? state.status === 'error' && state.error.code === 'RATE_LIMITED'
      ? 'GitHub rate limit exhausted — use “Try again” for cached data, or wait for the reset'
      : overview?.rateLimit && overview.rateLimit.resetAtMs !== null
        ? `GitHub rate limit exhausted — resets in ${resetInLabel(overview.rateLimit)}`
        : 'Refresh is unavailable right now'
    : 'Refresh from GitHub';

  // --- Build 5: save / compare / export handlers ---

  const currentRepoId = report && overview ? report.repoId : null;
  const isCurrentSaved = currentRepoId !== null && savedRepos.some((e) => e.repoId === currentRepoId);

  const toggleSaveCurrent = useCallback(() => {
    if (!overview || !report || !currentRepoId) return;
    setSaveMessage(null);
    const store = savedStoreRef.current as SavedReposStore;
    if (isCurrentSaved) {
      void store.remove(currentRepoId).then(() => store.load().then(setSavedRepos));
      return;
    }
    const entry: SavedRepoEntry = {
      repoId: currentRepoId,
      owner: overview.facts.owner,
      repo: overview.facts.name,
      overallScore: report.overallScore,
      grade: report.grade,
      coverage: report.coverage,
      confidence: report.confidence,
      fetchedAt: overview.facts.fetchedAt,
      savedAt: new Date().toISOString(),
    };
    void store.add(entry).then((result) => {
      if (!result.ok) {
        setSaveMessage(
          `Saved list is full (${MAX_SAVED_REPOS} repositories) — remove one to save another.`,
        );
        return;
      }
      return store.load().then(setSavedRepos);
    });
  }, [overview, report, currentRepoId, isCurrentSaved]);

  /** Open a saved repo in the panel: re-analyze it in place
   *  (cache-first, so no wasted API calls). */
  const openSaved = useCallback(
    (entry: SavedRepoEntry) => {
      const record: LastRepoRecord = {
        owner: entry.owner,
        repo: entry.repo,
        url: `https://github.com/${entry.owner}/${entry.repo}`,
        detectedAt: new Date().toISOString(),
      };
      setLastRepo(record);
      setCompareView(null);
      analyze(record);
    },
    [analyze],
  );

  const removeSaved = useCallback((repoId: string) => {
    const store = savedStoreRef.current as SavedReposStore;
    void store
      .remove(repoId)
      .then(() => store.load().then(setSavedRepos))
      .catch(() => undefined);
    setCompareSelected((prev) => prev.filter((id) => id !== repoId));
  }, []);

  const toggleCompare = useCallback((repoId: string) => {
    setCompareLimitMessage(null);
    setCompareSelected((prev) => {
      if (prev.includes(repoId)) return prev.filter((id) => id !== repoId);
      const check = canAddToCompare(prev, repoId);
      if (!check.allowed) {
        setCompareLimitMessage('Compare is limited to 3 repositories.');
        return prev;
      }
      return [...prev, repoId];
    });
  }, []);

  /** Fetch one repo's full analysis (cache-first) for the compare
   *  table. The current repo reuses the already-loaded result. */
  const fetchCompareEntry = useCallback(
    async (owner: string, repo: string): Promise<CompareEntry | null> => {
      if (state.status === 'ready' && state.overview.facts.owner === owner && state.overview.facts.name === repo) {
        return { repoId: state.report.repoId, overview: state.overview, report: state.report, activity: state.activity };
      }
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'ANALYZE_REPOSITORY',
          owner,
          repo,
        })) as
          | { type: 'ANALYSIS_COMPLETE'; overview: OverviewResult; report: RepositoryReport; activity: ActivityData }
          | { type: 'ANALYSIS_ERROR'; message: string }
          | undefined;
        if (!response || response.type !== 'ANALYSIS_COMPLETE') return null;
        return { repoId: response.report.repoId, overview: response.overview, report: response.report, activity: response.activity };
      } catch {
        return null;
      }
    },
    [state],
  );

  const runCompare = useCallback(() => {
    if (compareSelected.length < 2) return;
    setCompareView({ status: 'loading' });
    void (async () => {
      const entries: CompareEntry[] = [];
      for (const repoId of compareSelected) {
        const [, ownerRepo] = repoId.split(':');
        const [owner, repo] = (ownerRepo ?? '').split('/');
        if (!owner || !repo) continue;
        const entry = await fetchCompareEntry(owner, repo);
        if (entry) entries.push(entry);
      }
      if (entries.length < 2) {
        setCompareView({
          status: 'error',
          message: 'Could not load at least two of the selected repositories for comparison.',
        });
        return;
      }
      setCompareView({ status: 'ready', entries });
    })();
  }, [compareSelected, fetchCompareEntry]);

  const exportCurrent = useCallback(
    (format: 'json' | 'md') => {
      if (!overview || !report || !activity) return;
      setExportError(null);
      setExportBusy(true);
      const filename = exportFilename(overview.facts.owner, overview.facts.name, format);
      const content =
        format === 'json'
          ? toReportJson(overview, report, activity)
          : reportToMarkdown(overview, report, activity);
      const mimeType = format === 'json' ? 'application/json' : 'text/markdown';
      void downloadFile(filename, content, mimeType).then((result) => {
        setExportBusy(false);
        if (!result.ok) setExportError(result.error);
      });
    },
    [overview, report, activity],
  );

  const exportCompare = useCallback(() => {
    if (compareView?.status !== 'ready') return;
    setExportError(null);
    setExportBusy(true);
    void downloadFile(compareExportFilename(), compareToMarkdown(compareView.entries), 'text/markdown').then(
      (result) => {
        setExportBusy(false);
        if (!result.ok) setExportError(result.error);
      },
    );
  }, [compareView]);

  return (
    <main className="sidepanel">
      <header className="sidepanel-header">
        <img
          className="mark-img"
          src={browser.runtime.getURL('/icon/128.png')}
          alt="RepoRadar logo"
          width={36}
          height={36}
        />
        <div className="header-title">
          <h1>RepoRadar</h1>
          <p className="subtitle">Evidence-based repository intelligence</p>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          Theme: {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
        {lastRepo && (
          <button
            type="button"
            className="refresh"
            onClick={() => lastRepo && analyze(lastRepo, true)}
            disabled={refreshDisabled}
            title={refreshTitle}
            aria-label={refreshTitle}
          >
            Refresh
          </button>
        )}
      </header>

      {compareView && (
        <section className="card compare-card" aria-label="Repository comparison">
          <h2>Compare</h2>
          {compareView.status === 'loading' && <p className="muted">Loading the selected repositories…</p>}
          {compareView.status === 'error' && (
            <p className="error-title" role="alert">
              {compareView.message}
            </p>
          )}
          {compareView.status === 'ready' && (
            <>
              <div className="compare-table-wrap">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      {compareView.entries.map((entry) => (
                        <th scope="col" key={entry.repoId}>
                          {entry.overview.facts.fullName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {buildCompareRows(compareView.entries).map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.label}</th>
                        {row.values.map((value, i) => (
                          <td key={i} className={row.best[i] ? 'best' : undefined}>
                            {formatCompareValue(row.key, value)}
                            {row.best[i] ? ' ★ Best' : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Every column uses the same metric definitions. A score is an evidence-based
                heuristic, not proof of quality or safety — check coverage and confidence next to
                each score.
              </p>
              <div className="actions">
                <button type="button" className="btn" onClick={exportCompare} disabled={exportBusy}>
                  Download comparison (Markdown)
                </button>
                <button type="button" className="btn" onClick={() => setCompareView(null)}>
                  Back to report
                </button>
              </div>
            </>
          )}
          {compareView.status !== 'ready' && (
            <button type="button" className="btn" onClick={() => setCompareView(null)}>
              Back to report
            </button>
          )}
        </section>
      )}

      {state.status === 'idle' && (
        <section className="card" aria-label="No repository detected">
          <p className="muted">
            No repository detected yet. Open a GitHub repository page, then click “Analyze with
            RepoRadar”.
          </p>
        </section>
      )}

      {state.status === 'loading' && (
        <section className="card skeleton-card" aria-label="Loading repository" aria-busy="true">
          <h2>
            {state.repo.owner}/{state.repo.repo}
          </h2>
          <p className="muted">Loading repository from GitHub…</p>
          <div className="skeleton skeleton-gauge" aria-hidden="true" />
          <ul className="skeleton-rows" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="skeleton skeleton-row" />
            ))}
          </ul>
        </section>
      )}

      {state.status === 'error' && (
        <section className="card error-card" aria-label="Repository could not be loaded" role="alert">
          <h2>
            {state.repo.owner}/{state.repo.repo}
          </h2>
          <p className="error-title">{state.error.message}</p>
          <p className="muted">{errorGuidance(state.error)}</p>
          {state.error.detail && (
            <p className="muted small">
              Technical detail: <code>{state.error.detail}</code>
            </p>
          )}
          {state.error.code === 'RATE_LIMITED' && (
            <p className="muted small" role="status">
              “Try again” uses cached data if any is available — it will not make a fresh GitHub
              request while the limit is exhausted.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => analyze(state.repo, tryAgainForceRefresh(state.error.code))}
            >
              Try again
            </button>
            <button type="button" className="btn" onClick={runConnectionTest} disabled={connTest.status === 'loading'}>
              {connTest.status === 'loading' ? 'Testing…' : 'Test connection'}
            </button>
            <button type="button" className="btn" onClick={copyDiagnostics}>
              {diagnosticsCopied ? 'Copied ✓' : 'Copy diagnostics'}
            </button>
          </div>
          {connTest.status === 'done' && connTest.results && (
            <ul className="muted small conn-results" role="status">
              {connTest.results.map((result) => (
                <li key={result.host}>
                  {result.host}:{' '}
                  {result.ok
                    ? `reachable (${result.status}, ${result.elapsedMs} ms)`
                    : `unreachable — ${result.error ?? 'unknown error'}`}
                </li>
              ))}
              {connTest.results.some((r) => !r.ok && r.host === 'api.github.com') &&
                connTest.results.some((r) => r.ok && r.host === 'github.com') && (
                  <li>
                    github.com answers but api.github.com does not — the API host looks blocked
                    from this browser, not your whole connection.
                  </li>
                )}
            </ul>
          )}
          {connTest.status === 'done' && !connTest.results && (
            <p className="muted small" role="status">
              The connection test did not return a result. Try again in a moment.
            </p>
          )}
        </section>
      )}

      {overview && facts && (
        <>
          {overview.stale && (
            <p className="banner" role="status">
              Showing cached data from {formatDate(facts.fetchedAt)} — the live request failed
              {overview.liveError ? `: ${overview.liveError.message}` : '.'}
            </p>
          )}
          {overview.fromCache && !overview.stale && (
            <p className="banner cached" role="status">
              Cached · fetched {formatDate(facts.fetchedAt)}
            </p>
          )}

          {report && (
            <section className="card score-card" aria-label="Repository health score">
              {report.provisional ? (
                <>
                  <p className="banner provisional" role="status">
                    Not enough data to score — this is a provisional report. Coverage is{' '}
                    {report.coverage}%, below the 40% minimum for a score.
                  </p>
                  <h2>Health score: not enough data</h2>
                </>
              ) : (
                <div className="score-hero">
                  <Suspense fallback={<div className="skeleton skeleton-gauge" aria-hidden="true" />}>
                    <ScoreGauge
                      score={report.overallScore as number}
                      grade={report.grade as string}
                      gradeText={gradeLabel(report.grade)}
                    />
                  </Suspense>
                  <div className="score-meta">
                    <p className="score-meta-line">
                      Coverage <strong>{report.coverage}%</strong>
                    </p>
                    <p className="score-meta-line">{confidenceLabel(report.confidence)}</p>
                    <p className="score-meta-line muted small">
                      Score model {report.scoreModelVersion}
                    </p>
                    <p className="score-meta-line muted small">
                      Scored {formatDate(report.generatedAt)}
                    </p>
                  </div>
                </div>
              )}
              {report.provisional && (
                <p className="muted small">
                  Coverage {report.coverage}% · {confidenceLabel(report.confidence)} · Score model{' '}
                  {report.scoreModelVersion}
                </p>
              )}
              <ul className="category-rows" aria-label="Category scores — select a category to see its evidence">
                {report.categories.map((category) => (
                  <li key={category.key}>
                    <button
                      type="button"
                      className="cat-row"
                      onClick={(event) => openDrawer(category, event.currentTarget)}
                      aria-expanded={drawerCategory?.key === category.key}
                      aria-label={`${category.label}, score ${category.score === null ? 'not scored' : `${category.score} out of 100`}, ${categoryStatusNote(category)} — view evidence`}
                    >
                      <span className="cat-label">
                        {category.label}
                        <span className="cat-status muted"> — {categoryStatusNote(category)}</span>
                      </span>
                      <span className="lang-bar" aria-hidden="true">
                        <span style={{ width: `${category.score ?? 0}%` }} />
                      </span>
                      <span className="cat-score">
                        {category.score === null ? '—' : category.score}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {report.sampleNotes.length > 0 && (
                <ul className="muted small sample-notes">
                  {report.sampleNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              <div className="actions" aria-label="Save, compare and export this report">
                <button type="button" className="btn" onClick={toggleSaveCurrent}>
                  {isCurrentSaved ? 'Saved ✓ — Remove' : 'Save this repo'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => currentRepoId && toggleCompare(currentRepoId)}
                  aria-pressed={currentRepoId !== null && compareSelected.includes(currentRepoId)}
                >
                  {currentRepoId !== null && compareSelected.includes(currentRepoId)
                    ? 'In comparison ✓'
                    : 'Add to compare'}
                </button>
                <button type="button" className="btn" onClick={() => exportCurrent('json')} disabled={exportBusy}>
                  Download JSON
                </button>
                <button type="button" className="btn" onClick={() => exportCurrent('md')} disabled={exportBusy}>
                  Download Markdown
                </button>
              </div>
              {saveMessage && (
                <p className="muted small" role="status">
                  {saveMessage}
                </p>
              )}
              {exportError && (
                <p className="error-title small" role="alert">
                  Export failed: {exportError}
                </p>
              )}
            </section>
          )}

          {activity && (
            <section className="card" aria-label="Commit activity">
              <h3>Commit activity</h3>
              {activity.commits === null ? (
                <p className="muted small">Commit activity could not be collected.</p>
              ) : (
                <>
                  <Suspense fallback={<div className="skeleton skeleton-chart" aria-hidden="true" />}>
                    <ActivityChart activity={activity} nowMs={new Date(report?.generatedAt ?? Date.now()).getTime()} />
                  </Suspense>
                  {activity.truncated.commits && (
                    <p className="muted small">
                      Commit sample capped at 100 commits — the chart shows a sample, not the full
                      history.
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {report && (report.observations.good.length > 0 || report.observations.caution.length > 0 || report.observations.unknown.length > 0) && (
            <section className="card" aria-label="Observations">
              <h3>What the evidence shows</h3>
              {report.observations.good.length > 0 && (
                <>
                  <h4 className="obs-heading good"><span aria-hidden="true">✓ </span>Good signs</h4>
                  <ul className="obs">
                    {report.observations.good.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {report.observations.caution.length > 0 && (
                <>
                  <h4 className="obs-heading caution"><span aria-hidden="true">! </span>Possible concerns</h4>
                  <ul className="obs">
                    {report.observations.caution.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {report.observations.unknown.length > 0 && (
                <>
                  <h4 className="obs-heading unknown"><span aria-hidden="true">? </span>Could not be concluded</h4>
                  <ul className="obs">
                    {report.observations.unknown.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="card" aria-label="Repository overview">
            <h2>
              <a href={repoUrl({ owner: facts.owner, repo: facts.name })} target="_blank" rel="noreferrer">
                {facts.owner}/{facts.name}
              </a>
            </h2>
            {facts.description && <p className="description">{facts.description}</p>}
            <p className="badges">
              {facts.archived && <span className="badge warn">Archived</span>}
              {facts.isFork && <span className="badge">Fork</span>}
              {facts.licenseSpdxId && <span className="badge">{facts.licenseSpdxId}</span>}
              {facts.primaryLanguage && <span className="badge">{facts.primaryLanguage}</span>}
              <span className="badge">Default branch: {facts.defaultBranch}</span>
            </p>
            <dl className="metrics">
              <div>
                <dt>Stars</dt>
                <dd>{formatCount(facts.stars)}</dd>
              </div>
              <div>
                <dt>Forks</dt>
                <dd>{formatCount(facts.forks)}</dd>
              </div>
              <div>
                <dt>Watchers</dt>
                <dd>{formatCount(facts.watchers)}</dd>
              </div>
              <div>
                <dt>Open issues*</dt>
                <dd>{formatCount(facts.openIssuesCount)}</dd>
              </div>
            </dl>
            <p className="muted small">
              * GitHub counts open issues and open pull requests together in this number.
            </p>
            <p className="muted small">
              Created {formatDate(facts.createdAt)} · Updated {formatDate(facts.updatedAt)} · Last
              push {formatDate(facts.pushedAt)}
            </p>
          </section>

          <section className="card" aria-label="Languages">
            <h3>Languages</h3>
            {overview.languagesError && (
              <p className="muted small" role="status">
                Language data unavailable: {overview.languagesError.message}
              </p>
            )}
            {overview.languages && overview.languages.entries.length > 0 ? (
              <Suspense fallback={<div className="skeleton skeleton-chart" aria-hidden="true" />}>
                <LanguageDonut languages={overview.languages} />
              </Suspense>
            ) : (
              !overview.languagesError && <p className="muted small">No language data reported.</p>
            )}
          </section>

          <section className="card" aria-label="Evidence and rate limit">
            <h3>Evidence</h3>
            <p className="muted small">
              Fetched {new Date(facts.fetchedAt).toLocaleString()} from api.github.com · Score model
              1.0.0
            </p>
            <ul className="evidence">
              {overview.evidence.map((item) => (
                <li key={item.key}>
                  <strong>{item.key}:</strong> {String(item.value)}
                  <span className="muted"> — {item.source}</span>
                  {item.limitation && <span className="muted"> ({item.limitation})</span>}
                </li>
              ))}
            </ul>
            {overview.rateLimit && overview.rateLimit.remaining !== null && (
              <p className="muted small">
                GitHub API: {overview.rateLimit.remaining}
                {overview.rateLimit.limit !== null ? ` / ${overview.rateLimit.limit}` : ''} requests
                remaining
                {overview.rateLimit.resetAtMs !== null
                  ? ` · resets in ${resetInLabel(overview.rateLimit)}`
                  : ''}
              </p>
            )}
          </section>
        </>
      )}

      {savedRepos.length > 0 && (
        <section className="card" aria-label="Saved repositories">
          <h3>
            Saved repositories ({savedRepos.length}/{MAX_SAVED_REPOS})
          </h3>
          {savedRepos.length >= MAX_SAVED_REPOS && (
            <p className="muted small" role="status">
              Saved list is full — remove a repository to save another.
            </p>
          )}
          <ul className="saved-list">
            {savedRepos.map((entry) => (
              <li key={entry.repoId} className="saved-item">
                <button type="button" className="saved-open" onClick={() => openSaved(entry)} title={`Open ${entry.owner}/${entry.repo} in the panel`}>
                  {entry.owner}/{entry.repo}
                </button>
                <span className="saved-score">
                  {entry.overallScore === null
                    ? 'Not enough data'
                    : `${entry.overallScore} · ${entry.grade ?? ''}`}
                  {' · '}
                  {formatDate(entry.savedAt)}
                </span>
                <label className="compare-check">
                  <input
                    type="checkbox"
                    checked={compareSelected.includes(entry.repoId)}
                    onChange={() => toggleCompare(entry.repoId)}
                    aria-label={`Select ${entry.owner}/${entry.repo} for comparison`}
                  />
                  Compare
                </label>
                <button
                  type="button"
                  className="btn small-btn"
                  onClick={() => removeSaved(entry.repoId)}
                  aria-label={`Remove ${entry.owner}/${entry.repo} from saved repositories`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {compareLimitMessage && (
            <p className="muted small" role="status">
              {compareLimitMessage}
            </p>
          )}
          {compareSelected.length > 0 && (
            <p className="muted small" role="status">
              {compareSelected.length} selected for comparison
              {compareSelected.length < 2 ? ' — select at least 2 to compare' : ''}.
            </p>
          )}
          <button
            type="button"
            className="primary"
            onClick={runCompare}
            disabled={compareSelected.length < 2 || compareView?.status === 'loading'}
          >
            Compare ({compareSelected.length} selected)
          </button>
        </section>
      )}

      {drawerCategory && report && (
        <EvidenceDrawer category={drawerCategory} evidence={report.evidence} onClose={closeDrawer} />
      )}

      <footer className="muted small">
        A score is an evidence-based heuristic, not proof of quality or safety.
      </footer>
    </main>
  );
}

export default App;
