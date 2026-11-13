import { useEffect, useState } from 'react';

import { gradeLabel } from '../../src/analysis/scoring';
import type { ActivityData } from '../../src/domain/activity';
import type { RepositoryReport } from '../../src/domain/report';
import type { OverviewResult, ProviderErrorData } from '../../src/domain/repository';
import { APP_NAME } from '../../src/shared/constants';
import { repoUrl } from '../../src/shared/repo-url';
import { useTheme } from '../../src/shared/theme';
import { LAST_REPO_STORAGE_KEY, type LastRepoRecord } from '../../src/messaging/messages';
import './App.css';

type ScoreState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; report: RepositoryReport }
  | { status: 'unavailable' };

function confidenceLabel(confidence: RepositoryReport['confidence']): string {
  return confidence === 'high' ? 'High confidence' : confidence === 'medium' ? 'Medium confidence' : 'Low confidence';
}

function App() {
  const { resolved: theme, toggle: toggleTheme } = useTheme();
  const [lastRepo, setLastRepo] = useState<LastRepoRecord | null>(null);
  const [score, setScore] = useState<ScoreState>({ status: 'idle' });

  useEffect(() => {
    void browser.storage.local.get(LAST_REPO_STORAGE_KEY).then((result) => {
      const record = result[LAST_REPO_STORAGE_KEY] as LastRepoRecord | undefined;
      if (record) setLastRepo(record);
    });
    const onStorage = (changes: Record<string, { newValue?: unknown }>) => {
      const change = changes[LAST_REPO_STORAGE_KEY];
      if (change?.newValue) setLastRepo(change.newValue as LastRepoRecord);
    };
    browser.storage.onChanged.addListener(onStorage);
    return () => browser.storage.onChanged.removeListener(onStorage);
  }, []);

  // Score summary from the cache-first analysis (no force refresh):
  // when the side panel already analysed this repo, the summary
  // appears here without extra API calls. A failure simply hides
  // the summary — the popup stays usable.
  useEffect(() => {
    if (!lastRepo) return;
    setScore({ status: 'loading' });
    let cancelled = false;
    void browser.runtime
      .sendMessage({ type: 'ANALYZE_REPOSITORY', owner: lastRepo.owner, repo: lastRepo.repo })
      .then((response: unknown) => {
        if (cancelled) return;
        const res = response as
          | { type: 'ANALYSIS_COMPLETE'; overview: OverviewResult; report: RepositoryReport; activity: ActivityData }
          | { type: 'ANALYSIS_ERROR'; code: ProviderErrorData['code']; message: string }
          | undefined;
        if (res?.type === 'ANALYSIS_COMPLETE') {
          setScore({ status: 'ready', report: res.report });
        } else {
          setScore({ status: 'unavailable' });
        }
      })
      .catch(() => {
        if (!cancelled) setScore({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [lastRepo]);

  const openAnalysis = () => {
    if (!lastRepo) return;
    // Fixes 0.2.1 — the panel would not open: sidePanel.open()
    // needs the user gesture in THIS context. Routing the click
    // through a runtime message to the background loses the
    // activation, so open() throws there and nothing visible
    // happens. Open it here, where the click happened; only fall
    // back to the background route (full-tab fallback) if the
    // direct call fails or the API is unavailable.
    const openDirectly = async () => {
      const sidePanel = (
        browser as unknown as {
          sidePanel?: { open: (opts: { windowId?: number }) => Promise<void> };
        }
      ).sidePanel;
      if (!sidePanel) throw new Error('Side Panel API unavailable');
      let windowId: number | undefined;
      try {
        const win = await browser.windows.getLastFocused();
        windowId = win.id;
      } catch {
        try {
          const win = await browser.windows.getCurrent();
          windowId = win.id;
        } catch {
          // windowId stays undefined; open() uses the current window.
        }
      }
      await sidePanel.open(windowId !== undefined ? { windowId } : {});
    };
    void openDirectly()
      .then(() => window.close())
      .catch(() => {
        void browser.runtime
          .sendMessage({ type: 'OPEN_PANEL', owner: lastRepo.owner, repo: lastRepo.repo })
          .catch(() => undefined);
        window.close();
      });
  };

  return (
    <main className="popup">
      <header className="popup-header">
        <img
          className="mark-img"
          src={browser.runtime.getURL('/icon/128.png')}
          alt="RepoRadar logo"
          width={36}
          height={36}
        />
        <div className="header-title">
          <h1>{APP_NAME}</h1>
          <p className="subtitle">Evidence-based repository intelligence for GitHub</p>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </header>

      <section className="card" aria-label="Detected repository">
        {lastRepo ? (
          <>
            <p className="status">
              <span className="dot" aria-hidden="true" />
              {lastRepo.owner}/{lastRepo.repo}
            </p>
            <p className="muted">Detected {new Date(lastRepo.detectedAt).toLocaleString()}.</p>
            {score.status === 'loading' && (
              <p className="muted small" aria-busy="true">Loading latest score…</p>
            )}
            {score.status === 'ready' && (
              <p className="score-summary" aria-label="Latest health score summary">
                {score.report.provisional ? (
                  <>
                    Health score: <strong>not enough data</strong> · Coverage{' '}
                    {score.report.coverage}% · {confidenceLabel(score.report.confidence)}
                  </>
                ) : (
                  <>
                    Health score: <strong>{score.report.overallScore}</strong> ·{' '}
                    {score.report.grade} {gradeLabel(score.report.grade)} · Coverage{' '}
                    {score.report.coverage}% · {confidenceLabel(score.report.confidence)}
                  </>
                )}
              </p>
            )}
            <button type="button" className="primary" onClick={openAnalysis}>
              Open analysis
            </button>{' '}
            <a className="link" href={repoUrl(lastRepo)} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </>
        ) : (
          <>
            <p className="status">No repository detected</p>
            <p className="muted">
              Open a GitHub repository page first — RepoRadar detects it automatically.
            </p>
            <button type="button" className="primary" disabled>
              Open analysis
            </button>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
