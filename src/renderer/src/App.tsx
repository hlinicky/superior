import { browserUrl } from '@shared/browser'
import { nextWorkspaceMode } from './codeWorkspace'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { UsageFooter } from './components/UsageFooter'
import { ElevationNotice } from './components/ElevationNotice'
import { Sidebar } from './components/Sidebar'
import { TerminalPanel } from './components/TerminalPanel'
import type { SettingsSection } from './components/SettingsView'
import { QuickLaunch } from './components/QuickLaunch'
import { TerminalSearchOverlay } from './components/TerminalSearchOverlay'
import { PromptPicker } from './components/PromptPicker'
import { insertIntoTerminal } from './terminalInput'
import type { Command } from './commands'
import { TooltipLayer } from './components/TooltipLayer'
import { useConfirm, useToast } from './components/ui'
import type { FileContentMatch, FileLinkTarget, FsEntry } from './types'
import { fileLinkTargetToEntry } from './filePreview'
import { ensureBus } from './terminalBus'
import { useI18n } from './i18n'
import { useShortcuts, eventToChord, formatChord, isRecordingShortcut } from './shortcuts'
import { overlayCount } from './overlayStack'
import { advanceDoubleShift } from './doubleShift'
import { useGitStatus } from './hooks/useGitStatus'
import { useWorkspaceGitStats } from './hooks/useWorkspaceGitStats'
import { usePresets } from './hooks/usePresets'
import { useLayoutPresets } from './hooks/useLayoutPresets'
import { useCodeWorkspaces } from './hooks/useCodeWorkspaces'
import { useWorkspaceSessions } from './hooks/useWorkspaceSessions'
import { useTaskQueue } from './hooks/useTaskQueue'
import { useUpdateCheck } from './hooks/useUpdateCheck'
import { useAppUiState } from './hooks/useAppUiState'
import { useIntegrations } from './hooks/useIntegrations'
import {
  setActivitySessions,
  setActivityActiveWorkspace,
  setActivityActiveSession,
  setActivityNotifier,
  useAttentionWorkspaces
} from './activityStore'

// These surfaces are absent from the initial terminal workspace. Loading them
// on demand keeps the first renderer parse/evaluate path focused on the app
// chrome and xterm, while Vite gives each feature its own cached chunk.
const Onboarding = lazy(() => import('./components/Onboarding').then(({ Onboarding }) => ({ default: Onboarding })))

const SettingsView = lazy(() =>
  import('./components/SettingsView').then(({ SettingsView }) => ({ default: SettingsView }))
)
const BrowserDeck = lazy(() => import('./components/BrowserWorkspace').then(({ BrowserDeck }) => ({ default: BrowserDeck })))
const RightPanel = lazy(() =>
  import('./components/RightPanel').then(({ RightPanel }) => ({ default: RightPanel }))
)
const CodeWorkspace = lazy(() =>
  import('./components/CodeWorkspace').then(({ CodeWorkspace }) => ({ default: CodeWorkspace }))
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then(({ CommandPalette }) => ({ default: CommandPalette }))
)
const FileSearchPalette = lazy(() =>
  import('./components/FileSearchPalette').then(({ FileSearchPalette }) => ({
    default: FileSearchPalette
  }))
)
const ContentSearchPalette = lazy(() =>
  import('./components/ContentSearchPalette').then(({ ContentSearchPalette }) => ({
    default: ContentSearchPalette
  }))
)
const ProfileManager = lazy(() =>
  import('./components/ProfileManager').then(({ ProfileManager }) => ({ default: ProfileManager }))
)
const OpenProjectModal = lazy(() =>
  import('./components/OpenProjectModal').then(({ OpenProjectModal }) => ({ default: OpenProjectModal }))
)

function DeferredPanel(): React.JSX.Element {
  return <div className="flex min-h-0 flex-1" aria-busy="true" />
}

export default function App(): React.JSX.Element {
  const { t } = useI18n()
  const { shortcuts } = useShortcuts()
  const toast = useToast()
  const [onboarding, setOnboarding] = useState<'first-run' | 'replay' | null>(null)
  const [usageRevision, setUsageRevision] = useState(0)
  const [elevationNotice, setElevationNotice] = useState(false)
  useEffect(() => {
    let live = true
    void window.api.getSettings().then((settings) => {
      if (live && settings.ui.onboardingCompleted === false) setOnboarding('first-run')
      if (window.api.platform !== 'win32' || settings.ui.elevationWarningDismissed) return
      return window.api.isElevated().then((elevated) => { if (live && elevated) setElevationNotice(true) })
    }).catch((err: unknown) => { if (live) toast.error(String(err)) })
    return () => { live = false }
  }, [toast])

  const [error, setError] = useState<string | null>(null)
  // Errors reported by hooks/components surface as a sticky toast rather than
  // an inline banner, so they never shift the terminal layout.
  useEffect(() => {
    if (!error) return
    toast.error(error)
    setError(null)
  }, [error, toast])
  const {
    uiReady,
    view,
    setView,
    settingsSection,
    setSettingsSection,
    sidebarCollapsed,
    setSidebarCollapsed,
    rightSidebarOpen,
    setRightSidebarOpen,
    rightPanelLoaded,
    rightPanelWidth,
    rightResizing,
    startRightResize,
    launcherOpen,
    setLauncherOpen,
    searchOpen,
    setSearchOpen,
    fileSearchOpen,
    setFileSearchOpen,
    contentSearchOpen,
    setContentSearchOpen,
    paletteOpen,
    setPaletteOpen,
    palettePromptsOpen,
    setPalettePromptsOpen,
    profileManagerOpen,
    setProfileManagerOpen,
    projectModalOpen,
    setProjectModalOpen,
    projectModalSource,
    setProjectModalSource,
    setResumeProjectModal,
    closeSettings
  } = useAppUiState()
  const { integrations, reloadIntegrations } = useIntegrations()

  const presetsApi = usePresets()
  const { presets } = presetsApi
  const layoutPresets = useLayoutPresets()
  const ws = useWorkspaceSessions({ setError, t, presets })
  const code = useCodeWorkspaces(ws.activeWorkspaceId)
  const { dispatch: dispatchCode, act: actCode } = code
  const [browserLink, setBrowserLink] = useState<{ workspaceId: string; url: string } | null>(null)
  const selectBrowserWorkspace = ws.selectWorkspace
  const openTerminalUrl = useCallback((workspaceId: string, url: string) => {
    const safeUrl = browserUrl(url)
    setBrowserLink({ workspaceId, url: safeUrl })
    void selectBrowserWorkspace(workspaceId)
    dispatchCode(workspaceId, { type: 'mode', mode: 'browser' })
  }, [selectBrowserWorkspace, dispatchCode])
  const codeActive = code.current.mode === 'code'
  const terminalActive = code.current.mode === 'terminals'
  const [filesRevealRequest, setFilesRevealRequest] = useState(0)
  const codeEmpty = code.current.tabs.length === 0
  useEffect(() => {
    if (!uiReady || view !== 'main' || !ws.activeWorkspaceId || !codeActive || !codeEmpty) return
    setRightSidebarOpen(true)
    setFilesRevealRequest((request) => request + 1)
  }, [uiReady, view, ws.activeWorkspaceId, codeActive, codeEmpty, setRightSidebarOpen])
  const currentCodePath = code.current.selected[code.current.focusedGroup]
  const confirm = useConfirm()
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, ReadonlySet<string>>>({})
  const dirtyFilesRef = useRef(dirtyFiles)
  const onCodeDirtyChange = useCallback((id: string, path: string, dirty: boolean) => {
    const current = dirtyFilesRef.current[id] ?? new Set<string>()
    if (current.has(path) === dirty) return
    const next = new Set(current)
    if (dirty) next.add(path)
    else next.delete(path)
    dirtyFilesRef.current = { ...dirtyFilesRef.current, [id]: next }
    setDirtyFiles(dirtyFilesRef.current)
  }, [])
  const closeCodeFile = useCallback(async (id: string, path: string): Promise<boolean> => {
    if (dirtyFilesRef.current[id]?.has(path)) {
      const ok = await confirm({
        title: t('preview.unsavedTitle'), message: t('preview.unsavedConfirm'),
        confirmLabel: t('preview.discard'), tone: 'danger'
      })
      if (!ok) return false
    }
    dispatchCode(id, { type: 'close', path })
    onCodeDirtyChange(id, path, false)
    return true
  }, [dispatchCode, confirm, onCodeDirtyChange, t])
  const setCodeFile = useCallback(async (file: FsEntry | null, line?: number): Promise<boolean> => {
    if (!ws.activeWorkspaceId) return false
    if (file) { actCode({ type: 'open', file, line }); return true }
    return currentCodePath ? closeCodeFile(ws.activeWorkspaceId, currentCodePath) : true
  }, [ws.activeWorkspaceId, actCode, currentCodePath, closeCodeFile])
  const openTerminalFileInCode = useCallback((target: FileLinkTarget) => {
    void setCodeFile(fileLinkTargetToEntry(target), target.line)
  }, [setCodeFile])
  // The agent-task queue: persists in main, runs here (one task per folder at
  // a time, next starts when the previous task's terminal exits).
  const taskQueue = useTaskQueue({
    workspaces: ws.workspaces,
    activeWorkspaceId: ws.activeWorkspaceId,
    sessionsRestored: ws.sessionsRestored,
    sessions: ws.sessions,
    presets,
    applyState: ws.applyState,
    launchSessionIn: ws.launchSessionIn
  })
  // Jump to the workspace a task ran in (from the Tasks tab).
  const onJumpToTask = useCallback(
    (task: { workspaceId?: string }) => {
      if (task.workspaceId) void ws.selectWorkspace(task.workspaceId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.selectWorkspace]
  )
  // The active workspace's tabs + its active tab (drives the terminal grid).
  const activeTabs = ws.activeWorkspaceId ? ws.tabsByWs[ws.activeWorkspaceId] : undefined
  const activeTab = activeTabs?.tabs.find((tb) => tb.id === activeTabs.activeTabId)
  const activeTabSessionCount = ws.sessions.filter(
    (session) =>
      session.workspaceId === ws.activeWorkspaceId && session.tabId === activeTabs?.activeTabId
  ).length
  const [broadcastMode, setBroadcastMode] = useState(false)
  const { gitStatus, gitLoading, initializeGit, refresh: refreshGitStatus } = useGitStatus(
    ws.effectiveDir,
    ws.effectiveDir ? (ws.activeFolder?.path ?? null) : null,
    setError
  )
  // Per-workspace +/- line counts shown beside each name in the sidebar.
  // Scoped to the active profile: the sidebar renders only its folders, and
  // hidden profiles' repos must not be spawning git subprocesses every 3s.
  const visibleWorkspaces = useMemo(() => {
    const paths = new Set(ws.visibleFolders.map((f) => f.path))
    return ws.workspaces.filter((w) => paths.has(w.folderPath))
  }, [ws.workspaces, ws.visibleFolders])
  const workspaceGitStats = useWorkspaceGitStats(visibleWorkspaces, ws.visibleFolders)

  // Initialize the terminal data/exit bus once on mount.
  useEffect(() => {
    ensureBus()
  }, [])


  // Tint the title bar + sidebar with the active profile's color, so the
  // switched-to profile is recognizable at a glance. (Terminal preset colors
  // tint each terminal's own topbar, not the app chrome.)
  const activeProfileColor =
    ws.profiles.find((p) => p.id === ws.activeProfileId)?.color ?? null

  // Live terminal signals (busy spinner, attention pulse) live in an external
  // store the sidebar subscribes to, so per-chunk activity never re-renders the
  // whole app. We only feed it the current session/workspace mapping.
  useEffect(() => {
    setActivitySessions(ws.sessions)
  }, [ws.sessions])
  useEffect(() => {
    setActivityActiveWorkspace(ws.activeWorkspaceId)
  }, [ws.activeWorkspaceId])
  useEffect(() => {
    setActivityActiveSession(!terminalActive || view !== 'main' ? null : ws.activeSessionId)
  }, [ws.activeSessionId, terminalActive, view])
  const update = useUpdateCheck()

  // Native OS notification for explicit terminal attention while unfocused.
  // Names resolve through refs so the notifier callback never goes stale.
  const notifyCtxRef = useRef({ sessions: ws.sessions, workspaces: ws.workspaces, t })
  notifyCtxRef.current = { sessions: ws.sessions, workspaces: ws.workspaces, t }
  useEffect(() => {
    setActivityNotifier((sessionId, workspaceId, isCurrent) => {
      if (document.hasFocus()) return
      void window.api.getSettings().then((s) => {
        if (!s.notifications || document.hasFocus() || !isCurrent()) return
        const ctx = notifyCtxRef.current
        const session = ctx.sessions.find((x) => x.id === sessionId)
        const workspace = ctx.workspaces.find((w) => w.id === workspaceId)
        if (!session || !workspace) return
        const label = session.nickname
          ? `${session.label} · ${session.nickname}`
          : session.label
        window.api.notifyAgentFinished({
          workspaceId,
          sessionId,
          title: ctx.t('notify.finishedTitle', { label }),
          body: ctx.t('notify.finishedBody', { workspace: workspace.name })
        })
      }).catch((error) => console.error('[notifications] settings lookup failed:', error))
    })
    return () => setActivityNotifier(null)
  }, [])

  // Auto-launch a workspace's startup layout when it opens with no terminals.
  // Once per workspace per app run; surviving daemon sessions suppress it, so
  // an app restart never spawns duplicates next to restored terminals.
  const autoLaunchedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!ws.sessionsRestored || view !== 'main') return
    const wsId = ws.activeWorkspaceId
    if (!wsId || autoLaunchedRef.current.has(wsId)) return
    const layoutId = ws.workspaces.find((w) => w.id === wsId)?.startupLayoutId
    if (!layoutId) return
    // Layouts may still be loading — retry on the next effect run; a deleted
    // layout id simply never matches and is ignored.
    const layout = layoutPresets.layouts.find((l) => l.id === layoutId)
    if (!layout) return
    if (ws.sessions.some((s) => s.workspaceId === wsId)) {
      // Restored daemon sessions count as this run's launch: without marking,
      // closing the last of them would re-run this effect and spawn the
      // startup layout mid-run.
      autoLaunchedRef.current.add(wsId)
      return
    }
    autoLaunchedRef.current.add(wsId) // before the await — no double launch
    void ws.startLayout({
      presetIds: layout.presetIds.filter(Boolean),
      nicknames: layout.nicknames
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ws.sessionsRestored,
    ws.activeWorkspaceId,
    ws.workspaces,
    ws.sessions,
    layoutPresets.layouts,
    view
  ])

  // Clicking the notification selects the workspace the agent finished in.
  const selectWorkspaceRef = useRef(ws.selectWorkspace)
  selectWorkspaceRef.current = ws.selectWorkspace
  useEffect(
    () => window.api.onNotificationActivated((id) => selectWorkspaceRef.current(id)),
    []
  )

  const openPresets = useCallback(() => {
    setSettingsSection('presets')
    setView('settings')
  }, [setSettingsSection, setView])

  const openProjectModal = useCallback(
    (source: 'local' | 'git' | 'remote' = 'local') => {
      setProjectModalSource(source)
      setProjectModalOpen(true)
    },
    [setProjectModalSource, setProjectModalOpen]
  )
  // Stable reference — Sidebar is memoized, an inline arrow would defeat it.
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), [setSidebarCollapsed])

  // The palette memo rebuilds only on its listed deps, but the run callbacks
  // fire much later — route their ws calls through the latest instance so a
  // run never acts on a stale closure (ws.selectWorkspace/launchAgent close
  // over sessions/tabs that aren't memo deps).
  const wsRef = useRef(ws)
  wsRef.current = ws
  const codeActionsRef = useRef({ act: actCode, mode: code.current.mode })
  codeActionsRef.current = { act: actCode, mode: code.current.mode }

  // ⌘K command registry — every currently actionable thing, rebuilt from live
  // state. Terminal/git-scoped entries appear only when their target exists.
  const paletteCommands = useMemo<Command[]>(() => {
    const cmds: Command[] = []
    const folderName = (path: string): string =>
      ws.folders.find((f) => f.path === path)?.displayName?.trim() ||
      ws.folders.find((f) => f.path === path)?.name ||
      ''

    for (const w of ws.workspaces) {
      cmds.push({
        id: `ws:${w.id}`,
        title: `${folderName(w.folderPath)} / ${w.name}`,
        keywords: w.branch ?? '',
        section: t('palette.sectionWorkspaces'),
        run: () => wsRef.current.selectWorkspace(w.id)
      })
    }
    for (const p of ws.profiles) {
      if (p.id === ws.activeProfileId) continue
      cmds.push({
        id: `profile:${p.id}`,
        title: `${t('profile.switch')}: ${p.name}`,
        section: t('palette.sectionProfiles'),
        run: () => wsRef.current.selectProfile(p.id)
      })
    }
    if (ws.activeLaunchTarget) {
      for (const p of presets.filter((x) => x.active)) {
        cmds.push({
          id: `preset:${p.id}`,
          title: `${t('terminal.addTerminal')}: ${p.name}`,
          keywords: p.command,
          section: t('palette.sectionTerminals'),
          run: () => {
            codeActionsRef.current.act({ type: 'mode', mode: 'terminals' })
            void wsRef.current.launchAgent(p)
          }
        })
      }
      for (const layout of layoutPresets.layouts) {
        cmds.push({
          id: `layout:${layout.id}`,
          title: `${t('launcher.start')}: ${layout.name}`,
          section: t('palette.sectionTerminals'),
          run: () => {
            codeActionsRef.current.act({ type: 'mode', mode: 'terminals' })
            void wsRef.current.startLayout({
              presetIds: layout.presetIds.filter(Boolean),
              nicknames: layout.nicknames
            })
          }
        })
      }
    }
    if (ws.activeSessionId) {
      cmds.push({
        id: 'prompt:insert',
        title: t('prompts.insert'),
        section: t('palette.sectionTerminals'),
        run: () => {
          codeActionsRef.current.act({ type: 'mode', mode: 'terminals' })
          setPalettePromptsOpen(true)
        }
      })
      cmds.push({
        id: 'terminal:search',
        title: t('keyboard.searchTerminal'),
        section: t('palette.sectionTerminals'),
        hint: formatChord(shortcuts.searchTerminal),
        run: () => {
          codeActionsRef.current.act({ type: 'mode', mode: 'terminals' })
          setSearchOpen(true)
        }
      })
    }
    if (ws.effectiveDir) {
      const dir = ws.effectiveDir
      cmds.push(
        {
          id: 'files:search-content',
          title: t('keyboard.searchFileContents'),
          keywords: 'find grep content text files project',
          section: t('palette.sectionView'),
          hint: formatChord(shortcuts.searchFileContents),
          run: () => setContentSearchOpen(true)
        },
        {
          id: 'git:push',
          title: t('changes.push'),
          keywords: 'git push',
          section: t('palette.sectionGit'),
          run: () =>
            void window.api.gitPush(dir).then((r) => {
              if (r.error) toast.error(r.error)
              else toast.success(t('changes.pushed'))
            })
        },
        {
          id: 'git:pull',
          title: t('changes.pull'),
          keywords: 'git pull',
          section: t('palette.sectionGit'),
          run: () =>
            void window.api.gitPull(dir).then((r) => {
              if (r.error) toast.error(r.error)
              else toast.success(t('changes.pulled'))
            })
        }
      )
    }
    cmds.push(
      ...(ws.activeWorkspaceId ? [{
        id: 'view:code',
        title: t('code.switchMode'),
        section: t('palette.sectionView'),
        hint: formatChord(shortcuts.toggleWorkspaceMode),
        run: () => codeActionsRef.current.act({ type: 'mode', mode: nextWorkspaceMode(codeActionsRef.current.mode) })
      }] : []),
      {
        id: 'view:sidebar',
        title: t('keyboard.toggleSidebar'),
        section: t('palette.sectionView'),
        hint: formatChord(shortcuts.toggleSidebar),
        run: () => setSidebarCollapsed((c) => !c)
      },
      {
        id: 'view:right',
        title: t('keyboard.toggleRightPanel'),
        section: t('palette.sectionView'),
        hint: formatChord(shortcuts.toggleRightPanel),
        run: () => setRightSidebarOpen((o) => !o)
      },
      // Open project is always available — it's the only recovery action when
      // nothing is open yet; Manage profiles likewise had no palette entry.
      {
        id: 'project:open',
        title: t('sidebar.openProject'),
        keywords: 'open clone project folder',
        section: t('palette.sectionView'),
        run: () => setProjectModalOpen(true)
      },
      {
        id: 'profiles:manage',
        title: t('profile.manageTitle'),
        section: t('palette.sectionProfiles'),
        hint: formatChord(shortcuts.manageProfiles),
        run: () => setProfileManagerOpen(true)
      }
    )
    if (ws.activeLaunchTarget) {
      cmds.push({
        id: 'view:launcher',
        title: t('keyboard.openLauncher'),
        section: t('palette.sectionView'),
        hint: formatChord(shortcuts.openLauncher),
        run: () => setLauncherOpen(true)
      })
    }
    if (update.info?.updateAvailable) {
      cmds.push({
        id: 'update:install',
        title:
          update.progress.phase === 'downloaded'
            ? t('update.restart')
            : `${t('update.action')}: ${t('update.available', {
                version: update.info.latestVersion ?? ''
              })}`,
        keywords: 'update upgrade version install',
        section: t('palette.sectionView'),
        run: () =>
          update.progress.phase === 'downloaded'
            ? update.installAndRestart()
            : update.startDownload()
      })
    }
    const sections: { id: SettingsSection; label: string }[] = [
      { id: 'appearance', label: t('settings.appearance') },
      { id: 'terminal', label: t('terminalSettings.title') },
      { id: 'integrations', label: t('settings.integrations') },
      { id: 'presets', label: t('settings.terminalPresets') },
      { id: 'prompts', label: t('settings.prompts') },
      { id: 'daemons', label: t('settings.daemons') },
      { id: 'keyboard', label: t('settings.keyboard') },
      { id: 'shell', label: t('settings.shellCommand') }
    ]
    for (const s of sections) {
      cmds.push({
        id: `settings:${s.id}`,
        title: `${t('sidebar.settings')}: ${s.label}`,
        section: t('palette.sectionSettings'),
        run: () => {
          setSettingsSection(s.id)
          setView('settings')
        }
      })
    }
    return cmds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ws.workspaces,
    ws.folders,
    ws.profiles,
    ws.activeProfileId,
    ws.activeWorkspaceId,
    ws.activeLaunchTarget,
    ws.activeSessionId,
    ws.effectiveDir,
    presets,
    layoutPresets.layouts,
    shortcuts,
    update.info,
    update.progress.phase,
    t
  ])

  // Global keyboard shortcuts. Capture phase so they win over a focused terminal;
  // suppressed while a binding is being recorded in settings.
  const lastShiftAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (
      view !== 'main' ||
      launcherOpen ||
      searchOpen ||
      fileSearchOpen ||
      contentSearchOpen ||
      paletteOpen ||
      palettePromptsOpen ||
      projectModalOpen ||
      profileManagerOpen
    ) {
      lastShiftAtRef.current = null
    }
  }, [
    view,
    launcherOpen,
    searchOpen,
    fileSearchOpen,
    contentSearchOpen,
    paletteOpen,
    palettePromptsOpen,
    projectModalOpen,
    profileManagerOpen
  ])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isRecordingShortcut()) {
        lastShiftAtRef.current = null
        return
      }
      // While any overlay is open (palette, launcher, modals, menus…), global
      // chords must not reach through it — ⌘W behind a modal would kill the
      // focused terminal. Only "toggle palette closed" stays live; each overlay
      // handles its own Escape.
      const appOverlayOpen =
        launcherOpen ||
        searchOpen ||
        fileSearchOpen ||
        contentSearchOpen ||
        paletteOpen ||
        palettePromptsOpen ||
        projectModalOpen ||
        profileManagerOpen
      const anyOverlayOpen = appOverlayOpen || overlayCount() > 0

      if (anyOverlayOpen || view !== 'main' || !ws.effectiveDir) {
        lastShiftAtRef.current = null
      } else if (!e.repeat) {
        const doubleShift = advanceDoubleShift(lastShiftAtRef.current, e.key, performance.now())
        lastShiftAtRef.current = doubleShift.lastShiftAt
        if (doubleShift.triggered) {
          e.preventDefault()
          e.stopPropagation()
          setFileSearchOpen(true)
          return
        }
      }

      if (e.repeat) return
      if (anyOverlayOpen) {
        const chord = eventToChord(e)
        if (chord && chord === shortcuts.openPalette && paletteOpen) {
          e.preventDefault()
          e.stopPropagation()
          setPaletteOpen(false)
        }
        return
      }
      // Escape leaves settings (mouse-only Back button otherwise).
      if (e.key === 'Escape' && view === 'settings') {
        e.preventDefault()
        closeSettings()
        return
      }
      if (
        e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        /^[1-9]$/.test(e.key) &&
        view === 'main' && terminalActive &&
        ws.focusGridCell(Number(e.key) - 1)
      ) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const chord = eventToChord(e)
      if (!chord) return
      if (chord === shortcuts.toggleWorkspaceMode) {
        if (view !== 'main' || !ws.activeWorkspaceId) return
        e.preventDefault()
        e.stopPropagation()
        actCode({ type: 'mode', mode: nextWorkspaceMode(code.current.mode) })
      } else if (chord === shortcuts.toggleSidebar) {
        if (view !== 'main') return
        e.preventDefault()
        e.stopPropagation()
        setSidebarCollapsed((c) => !c)
      } else if (chord === shortcuts.openSettings) {
        e.preventDefault()
        e.stopPropagation()
        if (view === 'settings') closeSettings()
        else setView('settings')
      } else if (chord === shortcuts.maximizeFocusedCell) {
        if (view !== 'main' || !terminalActive) return
        e.preventDefault()
        e.stopPropagation()
        ws.toggleMaximizeFocused()
      } else if (chord === shortcuts.openLauncher) {
        if (view !== 'main' || !ws.activeLaunchTarget) return
        e.preventDefault()
        e.stopPropagation()
        setLauncherOpen(true)
      } else if (chord === shortcuts.toggleRightPanel) {
        if (view !== 'main') return
        e.preventDefault()
        e.stopPropagation()
        setRightSidebarOpen((o) => !o)
      } else if (chord === shortcuts.closeFocusedCell) {
        if (view !== 'main') return
        e.preventDefault()
        e.stopPropagation()
        if (codeActive) void setCodeFile(null)
        else if (!terminalActive) actCode({ type: 'mode', mode: 'terminals' })
        else if (ws.activeSessionId) ws.closeSession(ws.activeSessionId)
      } else if (chord === shortcuts.closePreview) {
        if (view !== 'main' || !codeActive || !currentCodePath) return
        e.preventDefault()
        e.stopPropagation()
        void setCodeFile(null)
      } else if (chord === shortcuts.prevTerminal) {
        if (view !== 'main' || !terminalActive || !ws.cycleSession(-1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.nextTerminal) {
        if (view !== 'main' || !terminalActive || !ws.cycleSession(1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.openFolder) {
        if (view !== 'main') return
        e.preventDefault()
        e.stopPropagation()
        void ws.addFolder()
      } else if (chord === shortcuts.prevWorkspace) {
        if (view !== 'main' || !ws.cycleWorkspace(-1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.nextWorkspace) {
        if (view !== 'main' || !ws.cycleWorkspace(1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.prevProfile) {
        if (view !== 'main' || !ws.cycleProfile(-1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.nextProfile) {
        if (view !== 'main' || !ws.cycleProfile(1)) return
        e.preventDefault()
        e.stopPropagation()
      } else if (chord === shortcuts.manageProfiles) {
        if (view !== 'main') return
        e.preventDefault()
        e.stopPropagation()
        setProfileManagerOpen((o) => !o)
      } else if (chord === shortcuts.searchFileContents) {
        if (view !== 'main' || !ws.effectiveDir) return
        e.preventDefault()
        e.stopPropagation()
        setContentSearchOpen(true)
      } else if (chord === shortcuts.searchTerminal) {
        if (view !== 'main' || !ws.activeSessionId) return
        // With a preview open, only a terminal-focused shortcut may open the
        // terminal search. Opening a file from the right sidebar leaves focus
        // on its result row, which previously misrouted Markdown find attempts
        // into xterm instead of the preview.
        if (!terminalActive) return
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(true)
      } else if (chord === shortcuts.openPalette) {
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // `ws` methods are read at event time; the curated list holds the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shortcuts,
    view,
    launcherOpen,
    searchOpen,
    fileSearchOpen,
    contentSearchOpen,
    paletteOpen,
    palettePromptsOpen,
    projectModalOpen,
    profileManagerOpen,
    closeSettings,
    ws.activeWorkspaceId,
    ws.activeLaunchTarget,
    ws.activeSessionId,
    ws.effectiveDir,
    ws.focusGridCell,
    ws.toggleMaximizeFocused,
    ws.closeSession,
    ws.cycleSession,
    ws.addFolder,
    ws.cycleWorkspace,
    ws.cycleProfile,
    codeActive,
    terminalActive,
    code.current.mode,
    currentCodePath,
    actCode,
    setCodeFile
  ])

  return (
    <div className="superior-app flex h-full flex-col text-fg">
      <TitleBar
        showToggle={view === 'main'}
        workspaceMode={code.current.mode}
        onWorkspaceModeChange={(mode) => actCode({ type: 'mode', mode })}
        workspaceModeEnabled={!!ws.activeWorkspaceId}
        gitStatus={view === 'main' ? gitStatus : null}
        gitLoading={gitLoading}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        onInitGit={initializeGit}
        gitDir={ws.effectiveDir}
        branchSwitchable={
          view === 'main' && !!gitStatus?.isRepository && !ws.activeWorkspace?.worktreePath
        }
        onBranchSwitched={refreshGitStatus}
        launcherEnabled={view === 'main' && !!ws.activeLaunchTarget}
        onOpenLauncher={() => {
          if (view === 'main' && ws.activeLaunchTarget) setLauncherOpen(true)
        }}
        onOpenPromptPicker={() => setPalettePromptsOpen(true)}
        promptPickerEnabled={
          view === 'main' && terminalActive && !!ws.activeSessionId
        }
        onToggleBroadcast={() => setBroadcastMode((active) => !active)}
        broadcastEnabled={
          view === 'main' && terminalActive && activeTabSessionCount > 0
        }
        broadcastActive={broadcastMode}
        onToggleRight={() => setRightSidebarOpen((o) => !o)}
        rightOpen={rightSidebarOpen}
        sidebarCollapsed={sidebarCollapsed}
        profiles={ws.profiles}
        activeProfileId={ws.activeProfileId}
        onSelectProfile={ws.selectProfile}
        onManageProfiles={() => setProfileManagerOpen(true)}
        tintColor={activeProfileColor}
      />

      <div
        className={`superior-workspace flex min-h-0 flex-1 ${
          rightSidebarOpen ? 'superior-workspace--right-open' : ''
        } ${view === 'settings' ? 'superior-workspace--settings' : ''}`}
      >
        {view === 'settings' && (
          <Suspense fallback={<DeferredPanel />}>
            <SettingsView
              initialSection={settingsSection}
              onSectionChange={setSettingsSection}
              onBack={closeSettings}
              onOpenOnboarding={() => setOnboarding('replay')}
              onIntegrationsChanged={reloadIntegrations}
              presets={presets}
              onSavePreset={presetsApi.savePreset}
              onDeletePreset={presetsApi.deletePreset}
              onReorderPresets={presetsApi.reorderPresets}
              onTogglePresetActive={presetsApi.togglePresetActive}
              onPickPresetImage={() => window.api.pickPresetImage()}
              onPresetsChanged={(state) => presetsApi.setPresets(state.presets)}
              workspaces={ws.workspaces}
              folders={ws.folders}
              onKillSession={ws.closeSession}
            />
          </Suspense>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 gap-2" style={{ display: view === 'settings' ? 'none' : undefined }}>
            <Sidebar
              folders={ws.visibleFolders}
              workspaces={ws.workspaces}
              activeWorkspaceId={ws.activeWorkspaceId}
              counts={ws.counts}
              gitStats={workspaceGitStats}
              update={update}
              collapsed={sidebarCollapsed}
              onExpand={expandSidebar}
              onOpenProject={openProjectModal}
              // Reopens on the last-visited section rather than resetting to Appearance.
              onOpenSettings={() => setView('settings')}
              onRemoveFolder={ws.removeFolder}
              onReorderFolders={ws.reorderFolders}
              onUpdateFolder={ws.updateFolder}
              onAddWorkspace={ws.addWorkspace}
              onAddWorktreeWorkspace={ws.addWorktreeWorkspace}
              onRenameWorkspace={ws.renameWorkspace}
              onRemoveWorkspace={ws.removeWorkspace}
              onSelectWorkspace={ws.selectWorkspace}
            />

            <div className="superior-main flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 min-w-0 flex-1">
                <div className="relative flex min-h-0 min-w-0 flex-1">
                <div className="absolute inset-0 flex" style={{ display: terminalActive ? undefined : 'none' }}>
                  <TerminalPanel
                    sessions={ws.sessions}
                    activeWorkspaceId={ws.activeWorkspaceId}
                    workingDir={ws.workingDirLabel}
                    layoutPresets={layoutPresets.layouts}
                    startupLayoutId={ws.activeWorkspace?.startupLayoutId}
                    onSetStartupLayout={(layoutId) => {
                      if (ws.activeWorkspaceId) void ws.setStartupLayout(ws.activeWorkspaceId, layoutId)
                    }}
                    onSaveLayoutPreset={layoutPresets.saveLayout}
                    onDeleteLayoutPreset={layoutPresets.deleteLayout}
                    activeSessionId={ws.activeSessionId}
                    maximizedId={ws.maximizedId}
                    activeTabId={activeTabs?.activeTabId}
                    surfaceActive={terminalActive && view === 'main'}
                    gridLayout={activeTab?.gridLayout}
                    presets={presets}
                    onSelect={ws.setActiveSessionId}
                    onOpenFileTarget={openTerminalFileInCode}
                    onOpenUrl={openTerminalUrl}
                    onToggleMaximize={ws.toggleMaximize}
                    onClose={ws.closeSession}
                    onRestart={ws.restartSession}
                    onSessionUpdate={ws.updateSession}
                    onSetNickname={ws.setSessionNickname}
                    onStart={ws.startLayout}
                    onLaunch={ws.launchAgent}
                    onManagePresets={openPresets}
                    onOpenProject={openProjectModal}
                    onGridLayoutChange={ws.setGridLayout}
                    broadcastMode={broadcastMode}
                    onBroadcastModeChange={setBroadcastMode}
                  />
                </div>
                <Suspense fallback={<DeferredPanel />}>
                  <BrowserDeck browserLink={browserLink} workspaces={ws.workspaces} activeWorkspaceId={ws.activeWorkspaceId}
                    visible={code.current.mode === 'browser' && view === 'main'} sessions={ws.sessions}
                    onSent={(session) => {
                      if (session.workspaceId !== ws.activeWorkspaceId) return
                      actCode({ type: 'mode', mode: 'terminals' })
                      ws.selectTab(session.workspaceId, session.tabId)
                      ws.setActiveSessionId(session.id)
                    }} />
                </Suspense>
                {Object.entries(code.workspaces).map(([id, state]) => (
                  <Suspense key={id} fallback={<DeferredPanel />}>
                    <CodeWorkspace state={state}
                      visible={id === ws.activeWorkspaceId && codeActive && view === 'main'}
                      dispatch={(action) => dispatchCode(id, action)}
                      onClose={(path) => void closeCodeFile(id, path)}
                      onDirtyChange={(path, dirty) => onCodeDirtyChange(id, path, dirty)}
                      dirtyPaths={dirtyFiles[id] ?? new Set<string>()}
                      onOpenFiles={() => setFileSearchOpen(true)} />
                  </Suspense>
                ))}
                </div>
              </div>
            </div>

            {/* Drag handle for resizing the right panel. */}
            {rightSidebarOpen && (
              <div
                onPointerDown={startRightResize}
                className="group flex w-1.5 shrink-0 cursor-col-resize items-stretch"
              >
                <span className="w-full bg-edge transition group-hover:bg-accent" />
              </div>
            )}
            {/* The width wrapper stays mounted for the close animation. The panel
                itself is loaded only on first use, then remains mounted so its
                UI state survives close/reopen cycles. */}
            <div
              style={{ width: rightSidebarOpen ? rightPanelWidth : 0 }}
              className={`flex shrink-0 overflow-hidden ${
                rightResizing ? '' : 'transition-[width] duration-200 ease-out'
              }`}
            >
              {rightPanelLoaded && (
                <Suspense fallback={<DeferredPanel />}>
                  <RightPanel
                    filesRevealRequest={filesRevealRequest}
                    workspaceId={ws.activeWorkspaceId}
                    sessions={ws.sessions}
                    onReviewSent={(session) => {
                      if (session.workspaceId !== ws.activeWorkspaceId) return
                      actCode({ type: 'mode', mode: 'terminals' })
                      ws.selectTab(session.workspaceId, session.tabId)
                      ws.setActiveSessionId(session.id)
                    }}
                    width={rightPanelWidth}
                    active={rightSidebarOpen}
                    folderPath={ws.effectiveDir}
                    isRemoteWorkspace={ws.activeFolder?.kind === 'remote'}
                    tasksFolder={ws.effectiveDir ? (ws.activeFolder?.path ?? null) : null}
                    taskQueue={taskQueue}
                    presets={presets}
                    onJumpToTask={onJumpToTask}
                    onOpenFile={(file) => void setCodeFile(file)}
                    selectedPath={currentCodePath}
                  />
                </Suspense>
              )}
            </div>
        </div>
      </div>

      <UsageFooter key={usageRevision} onManage={openPresets} />
      {elevationNotice && !onboarding && (
        <ElevationNotice
          onClose={() => setElevationNotice(false)}
          onNever={() => {
            setElevationNotice(false)
            window.api.setUiState({ elevationWarningDismissed: true }).catch((err: unknown) => toast.error(String(err)))
          }}
        />
      )}
      {onboarding && (
        <Suspense fallback={<DeferredPanel />}>
          <Onboarding
            replay={onboarding === 'replay'}
            onPresetsChanged={(state) => presetsApi.setPresets(state.presets)}
            onClose={() => {
              setOnboarding(null)
              setUsageRevision((value) => value + 1)
            }}
          />
        </Suspense>
      )}

      {view === 'main' && launcherOpen && (
        <QuickLaunch
          presets={presets.filter((p) => p.active)}
          onSelect={(preset) => { actCode({ type: 'mode', mode: 'terminals' }); void ws.launchAgent(preset) }}
          onClose={() => setLauncherOpen(false)}
          onManagePresets={openPresets}
        />
      )}

      {view === 'main' && searchOpen && ws.activeSessionId && (
        <TerminalSearchOverlay
          sessionId={ws.activeSessionId}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {view === 'main' && fileSearchOpen && ws.effectiveDir && (
        <Suspense fallback={null}>
          <FileSearchPalette
            folderPath={ws.effectiveDir}
            onOpenFile={async (file) => {
              if (await setCodeFile(file)) setFileSearchOpen(false)
            }}
            onClose={() => setFileSearchOpen(false)}
          />
        </Suspense>
      )}

      {view === 'main' && contentSearchOpen && ws.effectiveDir && (
        <Suspense fallback={null}>
          <ContentSearchPalette
            folderPath={ws.effectiveDir}
            onOpenMatch={async (match: FileContentMatch) => {
              const file: FsEntry = {
                name: match.name,
                path: match.path,
                isDirectory: false
              }
              if (await setCodeFile(file, match.line)) setContentSearchOpen(false)
            }}
            onClose={() => setContentSearchOpen(false)}
          />
        </Suspense>
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}

      {palettePromptsOpen && ws.activeSessionId && (
        <PromptPicker
          onPick={(p, submit) => {
            if (ws.activeSessionId) insertIntoTerminal(ws.activeSessionId, p.text, submit)
          }}
          onClose={() => setPalettePromptsOpen(false)}
        />
      )}

      {projectModalOpen && (
        <Suspense fallback={null}>
          <OpenProjectModal
            initialSource={projectModalSource}
            integrations={integrations}
            onOpenFolder={ws.addFolder}
            onClone={ws.cloneRepository}
            onAddRemote={ws.addRemoteFolder}
            onAddIntegration={() => {
              setProjectModalOpen(false)
              setResumeProjectModal(true)
              setSettingsSection('integrations')
              setView('settings')
            }}
            onClose={() => setProjectModalOpen(false)}
          />
        </Suspense>
      )}

      {profileManagerOpen && (
        <Suspense fallback={null}>
          <ProfileManager
            profiles={ws.profiles}
            activeProfileId={ws.activeProfileId}
            onAdd={ws.addProfile}
            onRename={ws.renameProfile}
            onUpdateColor={(id, color) => ws.updateProfile(id, { color })}
            onRemove={ws.removeProfile}
            onClose={() => setProfileManagerOpen(false)}
          />
        </Suspense>
      )}

      <AttentionBadgeSync />
      <TooltipLayer />
    </div>
  )
}

/**
 * Mirrors the attention-workspace count onto the dock/taskbar badge. A separate
 * null-rendering subscriber so attention changes never re-render App itself.
 */
function AttentionBadgeSync(): null {
  const attention = useAttentionWorkspaces()
  useEffect(() => {
    window.api.setBadgeCount(attention.size)
  }, [attention])
  return null
}
