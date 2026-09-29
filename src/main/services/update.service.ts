import { app, BrowserWindow, net, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC, type UpdateInfo, type UpdateProgress } from '@shared/types'
import { shutdownDaemon } from './daemonClient'
import { daemonLocksInstall } from './daemonHost'

const { autoUpdater } = electronUpdater

// Set once an update artifact is staged (installs on the next quit). Guards the
// daemon teardown so the app quit path can release the executable lock too.
let updateStaged = false
let daemonReleased = false

/** True while a downloaded Windows update has not yet checked whether the
 *  daemon must be brought down (it may hold a lock on the app executable). */
export function isUpdatePending(): boolean {
  return process.platform === 'win32' && updateStaged && !daemonReleased
}

/**
 * On Windows, bring the daemon down only when it runs from the install dir, so
 * its copy of the app executable stops locking the file the installer replaces.
 * A daemon on the relocated host (daemonHost.ts) sits outside the installer's
 * kill sweep and keeps its terminals across the update. Idempotent — safe to
 * call from both the explicit "restart to install" action and the app-quit
 * auto-install path.
 */
export async function releaseDaemonForUpdate(): Promise<void> {
  // Squirrel.Mac and Linux updates do not need this Windows executable-lock
  // workaround. Keep their detached daemon alive so its PTYs reconnect after
  // the updated app launches.
  if (process.platform !== 'win32') return
  if (daemonReleased) return
  daemonReleased = true
  const locks = await daemonLocksInstall().catch(() => true)
  if (locks) await shutdownDaemon().catch(() => undefined)
}

// The published repository whose GitHub releases we check against.
const OWNER = 'Engazan'
const REPO = 'superior'
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

/** Parse 'v1.2.3' / '1.2.3' into numeric parts, ignoring any pre-release suffix. */
function parseVersion(raw: string): number[] {
  const core = raw.trim().replace(/^v/i, '').split(/[-+]/, 1)[0]
  return core.split('.').map((n) => Number.parseInt(n, 10) || 0)
}

/** Positive when `a` is newer than `b`, negative when older, 0 when equal. */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Ask GitHub for the latest published release and compare it to the running
 * version. Network or parse failures resolve to "no update" so a check never
 * throws into the UI.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  const fallback: UpdateInfo = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: RELEASES_PAGE
  }
  try {
    const res = await net.fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${REPO}-app` }
    })
    if (!res.ok) return fallback
    const json = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = json.tag_name?.trim()
    if (!tag) return fallback
    const latestVersion = tag.replace(/^v/i, '')
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: json.html_url || RELEASES_PAGE
    }
  } catch {
    return fallback
  }
}

/** Open the release page in the system browser. Only github.com URLs are honored. */
export function openReleasePage(url?: string): Promise<void> {
  const safe = url && /^https:\/\/github\.com\//i.test(url) ? url : RELEASES_PAGE
  return shell.openExternal(safe)
}

// ── In-app download + install (electron-updater) ──────────────────────────────

/** Push the current download/install phase to the renderer's update banner. */
function sendStatus(status: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.UPDATE_STATUS, status)
  }
}

/**
 * Wire electron-updater's events to the renderer once at startup. We download
 * only on an explicit user click (autoDownload = false) but let a finished
 * download install on quit as a safety net (autoInstallOnAppQuit = true).
 */
export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('download-progress', (p) => {
    sendStatus({ phase: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', () => {
    updateStaged = true
    sendStatus({ phase: 'downloaded' })
  })
  autoUpdater.on('update-not-available', () => {
    // The banner came from our GitHub check, but the updater feed disagrees
    // (e.g. the release predates auto-update metadata). Fall back to the page.
    sendStatus({ phase: 'error', error: 'not-available' })
  })
  autoUpdater.on('error', (err) => {
    sendStatus({ phase: 'error', error: err?.message ?? String(err) })
  })
}

/**
 * Begin downloading the latest update. In a packaged build this pulls the
 * signed artifact via electron-updater (events drive the progress UI). In dev
 * there is no update feed, so we just open the release page and reset the UI.
 */
export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) {
    await openReleasePage()
    sendStatus({ phase: 'idle' })
    return
  }
  try {
    sendStatus({ phase: 'downloading', percent: 0 })
    const result = await autoUpdater.checkForUpdates()
    // checkForUpdates resolves before the download finishes; kick it off and let
    // the 'update-downloaded' event flip the UI to "restart to install".
    if (result?.updateInfo) await autoUpdater.downloadUpdate()
  } catch (err) {
    sendStatus({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

/** Quit and install a downloaded update, relaunching the app afterwards. */
export function quitAndInstall(): void {
  // Defer past the IPC reply so the renderer call resolves before we tear down.
  setImmediate(async () => {
    // Release the daemon's lock on the app executable first, or the Windows
    // installer stalls on "Superior cannot be closed" until the daemon idles out.
    await releaseDaemonForUpdate()
    autoUpdater.quitAndInstall(false, true)
  })
}
