import { stopAllSetups } from './services/worktree-setup.service'
import { browserService, registerBrowserIpc } from './ipc/browser.ipc'
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/types'
import { addFolderByPath } from './services/workspace.service'
import { getSettings } from './services/settings.service'
import { applyGlobalHotkey, releaseGlobalHotkey } from './services/global-hotkey.service'
import { extractFolderArg } from './services/cli-launcher.service'
import { registerCliLauncherIpc } from './ipc/cli-launcher.ipc'
import { registerWorkspaceIpc } from './ipc/workspace.ipc'
import { registerWorktreeIpc } from './ipc/worktree.ipc'
import { reconcileWorktrees } from './services/workspace.service'
import { registerAgentIpc } from './ipc/agent.ipc'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerPresetsIpc } from './ipc/presets.ipc'
import { registerPromptsIpc } from './ipc/prompts.ipc'
import { registerTasksIpc } from './ipc/tasks.ipc'
import { registerIntegrationsIpc } from './ipc/integrations.ipc'
import { registerWindowIpc, attachWindowMaximizeEvents } from './ipc/window.ipc'
import { registerNotificationsIpc } from './ipc/notifications.ipc'
import { registerLayoutIpc } from './ipc/layout.ipc'
import { registerGitIpc } from './ipc/git.ipc'
import { registerFsIpc } from './ipc/fs.ipc'
import { registerUpdateIpc } from './ipc/update.ipc'
import { registerClipboardIpc } from './ipc/clipboard.ipc'
import { isUpdatePending, releaseDaemonForUpdate } from './services/update.service'
import { daemonClient } from './services/daemonClient'
import { setTaskTransitionListener } from './services/tasks.service'
import { reportTaskTransition } from './services/backlog-report.service'

const isMac = process.platform === 'darwin'

// Display name for the macOS app menu, About panel, tray and notifications. Must
// be set before `ready`; otherwise dev runs inherit "Electron" from the bundle.
// On macOS the userData dir is case-insensitive, so this keeps the existing
// "superior" storage path. Packaged builds get the name from `build.productName`.
app.setName('Superior')

// Single instance: a second launch (e.g. `superior /some/dir`) must hand its
// folder to the already-running app instead of starting a rival process whose
// PTYs would fight over the daemon. The primary handles the hand-off below.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

/**
 * Register `dir` as a folder, make it active, and push the new state to the
 * renderer so an already-open window reflects it without a reload. Used by both
 * the cold-start CLI argument and the running-instance hand-off.
 */
function openFolderFromCli(dir: string): void {
  try {
    const state = addFolderByPath(dir)
    mainWindow?.webContents.send(IPC.WORKSPACE_STATE_CHANGED, state)
  } catch (err) {
    console.error('[cli] failed to open folder:', err)
  }
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** True only for http/https URLs — the sole schemes we hand to the OS browser. */
function isSafeExternalUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol)
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  // Transparent (vibrancy) theme: the window must be created without an opaque
  // background for the macOS blur-behind to show through the renderer's
  // translucent chrome. Runtime toggles go through IPC.WINDOW_SET_VIBRANCY.
  const vibrant = isMac && getSettings().theme === 'transparent'
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: vibrant ? '#00000000' : ['light', 'gradient-light'].includes(getSettings().theme) ? '#edf1f7' : '#0f131a',
    ...(vibrant ? { vibrancy: 'fullscreen-ui' as const } : {}),
    title: 'Superior',
    // macOS: keep the native traffic lights (inset) with a custom draggable bar.
    // Other platforms: fully frameless with our own window controls.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 23 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer displays untrusted repo content (markdown, source), so keep
      // the sandbox on as defense-in-depth. node-pty lives in the daemon, and the
      // preload only touches electron + process.platform, so this is safe.
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    browserService.closeWindow(win)
    if (mainWindow === win) mainWindow = null
  })
  attachWindowMaximizeEvents(win)

  // Open target=_blank / external links in the system browser, not a new window —
  // but only http(s), so untrusted repo content can't fire arbitrary OS protocol
  // handlers (file:, smb:, custom schemes) through openExternal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // The renderer only ever loads its own bundle. Block any attempt to navigate the
  // top frame elsewhere (e.g. a link in untrusted markdown): a remote origin here
  // would inherit the full `window.api` IPC surface exposed over the context bridge.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

if (gotSingleInstanceLock) app.whenReady().then(async () => {
  // Branded About panel (⌘? / app menu) instead of the default Electron one.
  app.setAboutPanelOptions({
    applicationName: 'Superior',
    applicationVersion: app.getVersion()
  })

  // Windows needs an explicit AppUserModelID for native notifications to show.
  if (process.platform === 'win32') app.setAppUserModelId('com.superior.app')

  // A folder passed on the command line (`superior /some/dir`). Persist it before
  // the window loads so the renderer's initial state read already includes it and
  // opens it active. Restrict cold-start parsing to the explicit `--path` flag in
  // development, where electron-vite passes the project dir as a bare argument.
  const startupDir = extractFolderArg(process.argv, process.cwd(), {
    requireFlag: !app.isPackaged
  })
  if (startupDir) {
    try {
      addFolderByPath(startupDir)
    } catch (err) {
      console.error('[cli] failed to open startup folder:', err)
    }
  }

  // Reconcile worktree-backed workspaces concurrently with window creation —
  // the renderer's initial state read awaits this (see registerWorkspaceIpc),
  // so the window isn't delayed but never sees pre-reconcile state.
  const reconciled = reconcileWorktrees()
    .then((warnings) => warnings.forEach((w) => console.warn('[worktree]', w)))
    .catch((err) => console.error('[worktree] reconcile failed:', err))

  registerWorkspaceIpc(reconciled)
  registerWorktreeIpc()
  registerAgentIpc()
  registerBrowserIpc(() => mainWindow)
  registerSettingsIpc(() => mainWindow)
  registerPresetsIpc()
  registerPromptsIpc()
  registerTasksIpc()
  // A finished agent run should have already updated the Backlog task its
  // prompt named by the time the phone is looked at.
  setTaskTransitionListener(reportTaskTransition)
  registerIntegrationsIpc()
  registerWindowIpc()
  registerNotificationsIpc(() => mainWindow)
  registerLayoutIpc()
  registerGitIpc()
  registerFsIpc()
  registerUpdateIpc()
  registerClipboardIpc()
  registerCliLauncherIpc()

  // Connect to (or launch) the terminal daemon so surviving sessions can be restored.
  daemonClient.ensure().catch((err) => console.error('[daemon] connect failed:', err))

  mainWindow = createWindow()

  // Restore the persisted system-wide show/hide hotkey (no-op when unset).
  applyGlobalHotkey(getSettings().globalHotkey, () => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

// A second `superior <dir>` launch lands here in the primary process: open the
// folder and surface the window. `workingDirectory` is the calling shell's cwd,
// so a relative argument still resolves correctly.
app.on('second-instance', (_event, argv, workingDirectory) => {
  const dir = extractFolderArg(argv, workingDirectory || process.cwd())
  if (dir) openFolderFromCli(dir)
  // macOS keeps the app alive with zero windows; recreate one so `superior
  // <dir>` visibly opens (the fresh window reads the just-persisted state).
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  focusMainWindow()
})

app.on('window-all-closed', () => {
  // PTYs live in the daemon and intentionally survive — do not kill them here.
  if (process.platform !== 'darwin') app.quit()
})

let setupsStopped = false
app.on('before-quit', (event) => {
  if (!setupsStopped) {
    event.preventDefault()
    void stopAllSetups().finally(() => { setupsStopped = true; app.quit() })
    return
  }
  // A staged update installs on quit; on Windows the daemon runs the app's own
  // executable and would keep the installer from replacing it. Take the daemon
  // down first, then let the quit resume (isUpdatePending() flips off once the
  // daemon is released, so the re-fired before-quit falls through).
  if (isUpdatePending()) {
    event.preventDefault()
    void releaseDaemonForUpdate().finally(() => app.quit())
    return
  }
  // Detach from the daemon without killing sessions, so they persist.
  daemonClient.disconnect()
})

app.on('will-quit', () => {
  releaseGlobalHotkey()
})
