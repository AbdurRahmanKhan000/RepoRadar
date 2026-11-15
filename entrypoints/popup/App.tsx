import { useEffect, useState } from 'react';

import { gradeLabel } from '../../src/analysis/scoring';
import type { ActivityData } from '../../src/domain/activity';
import type { RepositoryReport } from '../../src/domain/report';
import type { OverviewResult, ProviderErrorData } from '../../src/domain/repository';
import { APP_NAME } from '../../src/shared/constants';
import { repoUrl } from '../../src/shared/repo-url';
import { useTheme } from '../../src/shared/theme';
import {
  SAVED_REPOS_STORAGE_KEY,
  SavedReposStore,
  type SavedRepoEntry,
} from '../../src/storage/saved-repos';
import { LAST_REPO_STORAGE_KEY, type LastRepoRecord } from '../../src/messaging/messages';
import './App.css';

/** chrome.storage.local behind the KeyValueStore interface the
 *  SavedReposStore expects. */
const chromeLocalStore = {
  get: (key: string) => browser.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

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
  const [analysis, setAnalysis] = useState<{
    overview: OverviewResult;
    report: RepositoryReport;
  } | null>(null);

  // 0.3.0 — saved-repo management in the popup: the detected repo
  // can be saved or removed here, no side panel needed.
  const [savedRepos, setSavedRepos] = useState<SavedRepoEntry[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    void browser.storage.local.get(LAST_REPO_STORAGE_KEY).then((result) => {
      const record = result[LAST_REPO_STORAGE_KEY] as LastRepoRecord | undefined;
      if (record) setLastRepo(record);
    });
    const store = new SavedReposStore(chromeLocalStore);
    void store.load().then(setSavedRepos).catch(() => undefined);
    const onStorage = (changes: Record<string, { newValue?: unknown }>) => {
      const change = changes[LAST_REPO_STORAGE_KEY];
      if (change?.newValue) setLastRepo(change.newValue as LastRepoRecord);
      if (changes[SAVED_REPOS_STORAGE_KEY]) {
        void store.load().then(setSavedRepos).catch(() => undefined);
      }
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
    setAnalysis(null);
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
          setAnalysis({ overview: res.overview, report: res.report });
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

  const repoId = lastRepo ? `github:${lastRepo.owner}/${lastRepo.repo}` : null;
  const isSaved = repoId !== null && savedRepos.some((e) => e.repoId === repoId);

  /** Save the detected repo (needs the loaded score summary) or
   *  remove it when it is already saved. Updates the row
   *  immediately; the storage listener keeps it in sync. */
  const toggleSave = () => {
    if (!lastRepo || !repoId) return;
    setSaveMessage(null);
    const store = new SavedReposStore(chromeLocalStore);
    if (isSaved) {
      void store.remove(repoId).then(() => store.load().then(setSavedRepos));
      return;
    }
    if (!analysis) return;
    const entry: SavedRepoEntry = {
      repoId,
      owner: lastRepo.owner,
      repo: lastRepo.repo,
      overallScore: analysis.report.overallScore,
      grade: analysis.report.grade,
      coverage: analysis.report.coverage,
      confidence: analysis.report.confidence,
      fetchedAt: analysis.overview.facts.fetchedAt,
      savedAt: new Date().toISOString(),
    };
    void store.add(entry).then((result) => {
      if (!result.ok) {
        setSaveMessage('Saved list is full — remove a repository to save another.');
        return;
      }
      return store.load().then(setSavedRepos);
    });
  };

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
            <div className="saved-row">
              {isSaved ? (
                <>
                  <span className="saved-badge" role="status">
                    Saved ✓
                  </span>{' '}
                  <button type="button" className="btn" onClick={toggleSave}>
                    Remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={toggleSave}
                  disabled={!analysis}
                  title={analysis ? 'Save this repository' : 'Save once the score has loaded'}
                >
                  Save
                </button>
              )}
            </div>
            {saveMessage && (
              <p className="muted small" role="status">
                {saveMessage}
              </p>
            )}
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
