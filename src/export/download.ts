// File download for exports (Build 5).
// Primary path: the chrome.downloads API (needs the `downloads`
// permission). Fallback: an anchor + blob URL, which works in any
// extension page. If both fail, the caller surfaces a clear error
// — an export is never silently lost.

export type DownloadResult = { ok: true } | { ok: false; error: string };

/** e.g. reporadar-react-react-2026-11-13.json */
export function exportFilename(owner: string, repo: string, ext: 'json' | 'md', now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `reporadar-${safe(owner)}-${safe(repo)}-${date}.${ext}`;
}

export function compareExportFilename(now = new Date()): string {
  return `reporadar-compare-${now.toISOString().slice(0, 10)}.md`;
}

async function anchorDownload(filename: string, content: string, mimeType: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a moment to start the download before
    // revoking the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<DownloadResult> {
  const downloadsApi = (
    browser as unknown as {
      downloads?: { download: (opts: { url: string; filename: string; saveAs?: boolean }) => Promise<number> };
    }
  ).downloads;
  if (downloadsApi) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      await downloadsApi.download({ url, filename, saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true };
    } catch (error) {
      URL.revokeObjectURL(url);
      // Fall through to the anchor download below.
      try {
        await anchorDownload(filename, content, mimeType);
        return { ok: true };
      } catch (fallbackError) {
        return {
          ok: false,
          error: `Download failed (${error instanceof Error ? error.message : String(error)}; fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)})`,
        };
      }
    }
  }
  try {
    await anchorDownload(filename, content, mimeType);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
