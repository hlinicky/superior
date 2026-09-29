import type { WorktreeSetupConfig } from '@shared/worktree-setup'
import type { AgentStateEvent } from '@shared/agent-state'
import type { TerminalSettings } from '@shared/terminalSettings'
import { BROWSER_IPC, type BrowserKey, type BrowserRequest, type BrowserState, type BrowserSelection, type BrowserDesignRequest } from '@shared/browser'
import type { SendReviewArgs } from '@shared/types'
import { contextBridge, ipcRenderer as electronIpcRenderer } from 'electron'
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from '@shared/ipc-contract'
import {
  IPC,
  type AgentDataEvent,
  type AgentExitEvent,
  type AgentSession,
  type AgentUsage,
  type AccountUsage,
  type UsageResetRequest,
  type UsageResetOutcome,
  type UsageProfile,
  type AppSettings,
  type BranchInfo,
  type BranchSwitchResult,
  type CliToolFixResult,
  type CliToolId,
  type CliToolStatus,
  type CloneArgs,
  type CloneResult,
  type Integration,
  type IntegrationDraft,
  type IntegrationsState,
  type IntegrationTestResult,
  type RepoListResult,
  type CustomMemoryMutationResult,
  type CustomMemoryPreset,
  type CustomMemoryProvider,
  type FileReadOptions,
  type FileReadResult,
  type FileContentSearchResult,
  type FileWriteResult,
  type FolderUpdate,
  type GlobalHotkeyResult,
  type ProfileUpdate,
  type FsListResult,
  type GitActionResult,
  type GitDiff,
  type GitDiffFile,
  type GitLogEntry,
  type GitStatus,
  type Language,
  type TabsState,
  type PresetsState,
  type LayoutPreset,
  type LayoutPresetsState,
  type Prompt,
  type PromptsState,
  type RemoteFolderAddArgs,
  type RemoteFolderTestResult,
  type RemoteWorkspaceTarget,
  type AgentTask,
  type TasksState,
  type FileLinkTarget,
  type FileOpener,
  type OpenFileTargetResult,
  type ShellCommandInstallResult,
  type ShellCommandStatus,
  type ShortcutMap,
  type StartAgentArgs,
  type StartAgentResult,
  type TerminalPreset,
  type ThemeMode,
  type UiState,
  type UsagePrimary,
  type UpdateInfo,
  type UpdateProgress,
  type WorkspaceTabs,
  type WorkspaceState,
  type WorktreeAddArgs,
  type WorktreeAddResult
} from '@shared/types'

// Keep the public preload surface explicit, while checking every invoke against
// the shared channel payload/result contract used by main-process handlers.
const ipcRenderer = {
  invoke<Channel extends IpcInvokeChannel>(
    channel: Channel,
    ...args: IpcInvokeArgs<Channel>
  ): Promise<IpcInvokeResult<Channel>> {
    return electronIpcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<Channel>>
  },
  send: electronIpcRenderer.send.bind(electronIpcRenderer),
  on: electronIpcRenderer.on.bind(electronIpcRenderer),
  removeListener: electronIpcRenderer.removeListener.bind(electronIpcRenderer)
}

const api = {
  /** Host platform, e.g. 'darwin' | 'win32' | 'linux'. */
  platform: process.platform,
  getUsageProfiles(): Promise<UsageProfile[]> {
    return ipcRenderer.invoke(IPC.USAGE_PROFILES)
  },
  getAccountUsage(ids: string[], force = false): Promise<AccountUsage[]> {
    return ipcRenderer.invoke(IPC.USAGE_ACCOUNTS, ids, force)
  },
  consumeUsageReset(request: UsageResetRequest): Promise<UsageResetOutcome> {
    return ipcRenderer.invoke(IPC.USAGE_RESET, request)
  },

  listWorkspaces(): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_LIST)
  },

  /** Create a new (empty) profile and switch to it. */
  addProfile(name: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.PROFILE_ADD, name)
  },

  renameProfile(id: string, name: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.PROFILE_RENAME, { id, name })
  },

  /** Update a profile's accent color (tints the title bar + sidebar when active). */
  updateProfile(id: string, patch: ProfileUpdate): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.PROFILE_UPDATE, { id, patch })
  },

  /** Delete a profile and all of its folders/workspaces (never the last one). */
  removeProfile(id: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.PROFILE_REMOVE, id)
  },

  setActiveProfile(id: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.PROFILE_SET_ACTIVE, id)
  },

  addFolder(): Promise<WorkspaceState | null | { error: string }> {
    return ipcRenderer.invoke(IPC.FOLDER_ADD)
  },

  addRemoteFolder(args: RemoteFolderAddArgs): Promise<WorkspaceState | { error: string }> {
    return ipcRenderer.invoke(IPC.FOLDER_ADD_REMOTE, args)
  },

  testRemoteFolder(args: RemoteWorkspaceTarget): Promise<RemoteFolderTestResult> {
    return ipcRenderer.invoke(IPC.REMOTE_WORKSPACE_TEST, args)
  },

  removeFolder(folderPath: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.FOLDER_REMOVE, folderPath)
  },

  /** Persist a new folder order (the sidebar's drag-to-reorder). */
  reorderFolders(orderedPaths: string[]): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.FOLDER_REORDER, orderedPaths)
  },

  /** Update a folder's display name / custom icon (its path stays fixed). */
  updateFolder(folderPath: string, patch: FolderUpdate): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.FOLDER_UPDATE, { folderPath, patch })
  },

  addWorkspace(folderPath: string, name: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_ADD, { folderPath, name })
  },

  renameWorkspace(id: string, name: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_RENAME, { id, name })
  },

  /** Set (or clear) the layout auto-launched when the workspace opens empty. */
  setWorkspaceStartupLayout(id: string, layoutId: string | null): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_SET_STARTUP_LAYOUT, { id, layoutId })
  },

  removeWorkspace(id: string, force = false): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_REMOVE, { id, force })
  },

  setActiveWorkspace(id: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC.WORKSPACE_SET_ACTIVE, id)
  },

  /** Workspace state pushed by main (e.g. a folder opened via `superior .`). */
  onWorkspaceStateChanged(cb: (state: WorkspaceState) => void): () => void {
    const listener = (_e: unknown, state: WorkspaceState): void => cb(state)
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener)
  },

  /** Whether the `superior` shell command is installed and resolvable. */
  getShellCommandStatus(): Promise<ShellCommandStatus> {
    return ipcRenderer.invoke(IPC.SHELL_COMMAND_STATUS)
  },

  /** Install the `superior` shell command (and put it on PATH). */
  installShellCommand(): Promise<ShellCommandInstallResult> {
    return ipcRenderer.invoke(IPC.SHELL_COMMAND_INSTALL)
  },

  /** Local branches in a folder, for the worktree-create picker. */
  listBranches(folderPath: string): Promise<BranchInfo[]> {
    return ipcRenderer.invoke(IPC.WORKTREE_LIST_BRANCHES, folderPath)
  },

  /** Create a git worktree + a workspace bound to it. */
  addWorktreeWorkspace(args: WorktreeAddArgs): Promise<WorktreeAddResult> {
    return ipcRenderer.invoke(IPC.WORKSPACE_ADD_WORKTREE, args)
  },

  /** True if a worktree has uncommitted changes (gate before a forced remove). */
  waitWorktreeSetup(workspaceId: string) {
    return ipcRenderer.invoke(IPC.WORKTREE_SETUP_WAIT, workspaceId)
  },
  getWorktreeSetup(workspaceId: string) {
    return ipcRenderer.invoke(IPC.WORKTREE_SETUP_GET, workspaceId)
  },
  saveWorktreeSetup(workspaceId: string, config: WorktreeSetupConfig) {
    return ipcRenderer.invoke(IPC.WORKTREE_SETUP_SAVE, workspaceId, config)
  },
  retryWorktreeSetup(workspaceId: string) {
    return ipcRenderer.invoke(IPC.WORKTREE_SETUP_RETRY, workspaceId)
  },
  cancelWorktreeSetup(workspaceId: string) {
    return ipcRenderer.invoke(IPC.WORKTREE_SETUP_CANCEL, workspaceId)
  },
  isWorktreeDirty(worktreePath: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC.WORKTREE_IS_DIRTY, worktreePath)
  },

  getGitStatus(folderPath: string): Promise<GitStatus> {
    return ipcRenderer.invoke(IPC.GIT_STATUS, folderPath)
  },

  initGit(folderPath: string): Promise<GitStatus> {
    return ipcRenderer.invoke(IPC.GIT_INIT, folderPath)
  },

  getGitDiff(folderPath: string): Promise<GitDiff> {
    return ipcRenderer.invoke(IPC.GIT_DIFF, folderPath)
  },

  /** Check out `branch` in `folderPath`. Pass `{ stash: true }` to retry past a dirty-tree conflict. */
  switchBranch(
    folderPath: string,
    branch: string,
    opts?: { stash?: boolean }
  ): Promise<BranchSwitchResult> {
    return ipcRenderer.invoke(IPC.GIT_SWITCH_BRANCH, { folderPath, branch, opts })
  },

  /** Create `branch` from the current HEAD and switch to it. */
  createBranch(folderPath: string, branch: string): Promise<BranchSwitchResult> {
    return ipcRenderer.invoke(IPC.GIT_CREATE_BRANCH, { folderPath, branch })
  },

  gitStage(folderPath: string, path: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_STAGE, { folderPath, path })
  },

  gitUnstage(folderPath: string, path: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_UNSTAGE, { folderPath, path })
  },

  gitStageAll(folderPath: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_STAGE_ALL, folderPath)
  },

  gitUnstageAll(folderPath: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_UNSTAGE_ALL, folderPath)
  },

  gitCommit(folderPath: string, message: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_COMMIT, { folderPath, message })
  },

  gitPush(folderPath: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_PUSH, folderPath)
  },

  gitPull(folderPath: string): Promise<GitActionResult> {
    return ipcRenderer.invoke(IPC.GIT_PULL, folderPath)
  },

  gitLog(folderPath: string, limit?: number): Promise<GitLogEntry[]> {
    return ipcRenderer.invoke(IPC.GIT_LOG, folderPath, limit)
  },

  gitShowCommit(folderPath: string, hash: string): Promise<GitDiffFile[]> {
    return ipcRenderer.invoke(IPC.GIT_SHOW_COMMIT, { folderPath, hash })
  },

  listDir(dirPath: string): Promise<FsListResult> {
    return ipcRenderer.invoke(IPC.FS_LIST_DIR, dirPath)
  },

  searchFiles(rootPath: string, query: string): Promise<FsListResult> {
    return ipcRenderer.invoke(IPC.FS_SEARCH, rootPath, query)
  },

  searchFileContents(rootPath: string, query: string): Promise<FileContentSearchResult> {
    return ipcRenderer.invoke(IPC.FS_SEARCH_CONTENT, rootPath, query)
  },

  readFile(filePath: string, opts: FileReadOptions): Promise<FileReadResult> {
    return ipcRenderer.invoke(IPC.FS_READ_FILE, filePath, opts)
  },

  /** Overwrite a previewed text file with edited content. */
  writeFile(filePath: string, content: string): Promise<FileWriteResult> {
    return ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content)
  },

  openPath(filePath: string): Promise<string> {
    return ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, filePath)
  },

  /** Validate a path-like token from terminal output against the workspace. */
  resolveFileLink(cwd: string | null, token: string): Promise<FileLinkTarget | null> {
    return ipcRenderer.invoke(IPC.FS_RESOLVE_FILE_LINK, cwd, token)
  },

  /** Open a resolved terminal file link in the configured editor. */
  openFileTarget(target: FileLinkTarget): Promise<OpenFileTargetResult> {
    return ipcRenderer.invoke(IPC.FS_OPEN_FILE_TARGET, target)
  },

  /** Persist which editor terminal file links open in. */
  setFileOpener(opener: FileOpener): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_FILE_OPENER, opener)
  },

  setTerminalSettings(patch: Partial<TerminalSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_TERMINAL, patch)
  },
  writeTerminalClipboard(text: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC.TERMINAL_CLIPBOARD_WRITE, text)
  },
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_GET)
  },

  setTheme(theme: ThemeMode): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_THEME, theme)
  },

  setLanguage(language: Language): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_LANGUAGE, language)
  },

  setShortcuts(shortcuts: ShortcutMap): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_SHORTCUTS, shortcuts)
  },

  setUiState(ui: Partial<UiState>): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_UI, ui)
  },

  /** Windows only: whether agents would inherit an administrator token. */
  isElevated(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.APP_IS_ELEVATED)
  },

  setAttentionColor(color: string): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_ATTENTION_COLOR, color)
  },

  setAccentColor(color: string | null): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_ACCENT_COLOR, color)
  },

  /** Enable/disable live Claude usage in the terminal topbar. */
  setUsageTracking(enabled: boolean): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_USAGE_TRACKING, enabled)
  },

  setNotifications(enabled: boolean): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_NOTIFICATIONS, enabled)
  },

  setAgentHooks(enabled: boolean): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_AGENT_HOOKS, enabled)
  },

  /** Persist + register the system-wide show/hide hotkey (null disables). */
  setGlobalHotkey(chord: string | null): Promise<GlobalHotkeyResult> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_GLOBAL_HOTKEY, chord)
  },

  /** Show an explicit terminal attention notification; clicking focuses its workspace. */
  notifyAgentFinished(payload: { sessionId: string; workspaceId: string; title: string; body: string }): void {
    ipcRenderer.send(IPC.NOTIFY_FINISHED, payload)
  },

  /** Subscribe to notification clicks. Returns an unsubscribe function. */
  onNotificationActivated(cb: (workspaceId: string) => void): () => void {
    const listener = (_e: unknown, workspaceId: string): void => cb(workspaceId)
    ipcRenderer.on(IPC.NOTIFY_ACTIVATED, listener)
    return () => ipcRenderer.removeListener(IPC.NOTIFY_ACTIVATED, listener)
  },

  /** Mirror the attention-workspace count on the dock/taskbar badge. */
  setBadgeCount(count: number): void {
    ipcRenderer.send(IPC.APP_SET_BADGE, count)
  },

  /** Choose which usage figure the topbar badge leads with. */
  setUsagePrimary(primary: UsagePrimary): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS_SET_USAGE_PRIMARY, primary)
  },

  checkForUpdates(): Promise<UpdateInfo> {
    return ipcRenderer.invoke(IPC.UPDATE_CHECK)
  },

  openReleasePage(url: string): Promise<void> {
    return ipcRenderer.invoke(IPC.UPDATE_OPEN, url)
  },

  /** Start downloading the latest update (progress arrives via onUpdateStatus). */
  downloadUpdate(): Promise<void> {
    return ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD)
  },

  /** Quit and install a downloaded update, relaunching afterwards. */
  installUpdate(): Promise<void> {
    return ipcRenderer.invoke(IPC.UPDATE_INSTALL)
  },

  /** Subscribe to update download/install progress. Returns an unsubscribe fn. */
  onUpdateStatus(cb: (status: UpdateProgress) => void): () => void {
    const listener = (_e: unknown, payload: UpdateProgress): void => cb(payload)
    ipcRenderer.on(IPC.UPDATE_STATUS, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, listener)
  },

  /** Saved git-forge integrations (GitHub / GitLab / Gitea connections). */
  listIntegrations(): Promise<IntegrationsState> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_LIST)
  },

  /** Upsert an integration by id (a blank id creates a new one). */
  saveIntegration(integration: Integration): Promise<IntegrationsState> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_SAVE, integration)
  },

  deleteIntegration(id: string): Promise<IntegrationsState> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_DELETE, id)
  },

  /** Probe a (possibly unsaved) connection against the forge's API. */
  testIntegration(draft: IntegrationDraft): Promise<IntegrationTestResult> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_TEST, draft)
  },

  /** List repositories the integration's token can access. */
  listRepos(integrationId: string): Promise<RepoListResult> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_LIST_REPOS, integrationId)
  },

  /** Pick a destination dir, clone the repo there, and register it as a folder. */
  cloneRepository(args: CloneArgs): Promise<CloneResult> {
    return ipcRenderer.invoke(IPC.INTEGRATIONS_CLONE, args)
  },

  listPresets(): Promise<PresetsState> {
    return ipcRenderer.invoke(IPC.PRESETS_LIST)
  },

  savePreset(preset: TerminalPreset): Promise<PresetsState> {
    return ipcRenderer.invoke(IPC.PRESETS_SAVE, preset)
  },

  deletePreset(id: string): Promise<PresetsState> {
    return ipcRenderer.invoke(IPC.PRESETS_DELETE, id)
  },

  reorderPresets(orderedIds: string[]): Promise<PresetsState> {
    return ipcRenderer.invoke(IPC.PRESETS_REORDER, orderedIds)
  },

  setPresetActive(id: string, active: boolean): Promise<PresetsState> {
    return ipcRenderer.invoke(IPC.PRESETS_SET_ACTIVE, { id, active })
  },

  pickPresetImage(): Promise<{ dataUrl: string } | null> {
    return ipcRenderer.invoke(IPC.PRESETS_PICK_IMAGE)
  },

  listLayoutPresets(): Promise<LayoutPresetsState> {
    return ipcRenderer.invoke(IPC.LAYOUT_PRESETS_LIST)
  },

  saveLayoutPreset(layout: LayoutPreset): Promise<LayoutPresetsState> {
    return ipcRenderer.invoke(IPC.LAYOUT_PRESETS_SAVE, layout)
  },

  deleteLayoutPreset(id: string): Promise<LayoutPresetsState> {
    return ipcRenderer.invoke(IPC.LAYOUT_PRESETS_DELETE, id)
  },

  listPrompts(): Promise<PromptsState> {
    return ipcRenderer.invoke(IPC.PROMPTS_LIST)
  },

  savePrompt(prompt: Prompt): Promise<PromptsState> {
    return ipcRenderer.invoke(IPC.PROMPTS_SAVE, prompt)
  },

  deletePrompt(id: string): Promise<PromptsState> {
    return ipcRenderer.invoke(IPC.PROMPTS_DELETE, id)
  },

  /** The persisted task queue (all folders) plus its pause flag. */
  listTasks(): Promise<TasksState> {
    return ipcRenderer.invoke(IPC.TASKS_LIST)
  },

  /** Upsert a task by id (adds when new, replaces when existing). */
  saveTask(task: AgentTask): Promise<TasksState> {
    return ipcRenderer.invoke(IPC.TASKS_SAVE, task)
  },

  deleteTask(id: string): Promise<TasksState> {
    return ipcRenderer.invoke(IPC.TASKS_DELETE, id)
  },

  /** Drop every finished (done/failed/canceled) task of one folder. */
  clearFinishedTasks(folderPath: string): Promise<TasksState> {
    return ipcRenderer.invoke(IPC.TASKS_CLEAR_FINISHED, folderPath)
  },

  /** Pause/resume the queue (running tasks finish; queued ones wait). */
  setTasksPaused(paused: boolean): Promise<TasksState> {
    return ipcRenderer.invoke(IPC.TASKS_SET_PAUSED, paused)
  },

  listCustomMemoryPresets(): Promise<CustomMemoryPreset[]> {
    return ipcRenderer.invoke(IPC.CUSTOM_MEMORY_LIST)
  },

  createCustomMemoryPreset(
    provider: CustomMemoryProvider,
    name: string
  ): Promise<CustomMemoryMutationResult> {
    return ipcRenderer.invoke(IPC.CUSTOM_MEMORY_CREATE, { provider, name })
  },

  addCustomMemoryAlias(directoryName: string): Promise<CustomMemoryPreset[]> {
    return ipcRenderer.invoke(IPC.CUSTOM_MEMORY_ADD_ALIAS, directoryName)
  },

  addCustomMemoryTerminalPreset(
    directoryName: string
  ): Promise<CustomMemoryMutationResult> {
    return ipcRenderer.invoke(IPC.CUSTOM_MEMORY_ADD_TERMINAL_PRESET, directoryName)
  },

  /** Whether claude/codex are installed and resolvable in the app's terminal. */
  checkCliTools(force?: boolean): Promise<CliToolStatus[]> {
    return ipcRenderer.invoke(IPC.CLI_TOOLS_CHECK, force)
  },

  /** Auto-fix a CLI that's installed but not on the app shell's PATH. */
  fixCliTool(id: CliToolId): Promise<CliToolFixResult> {
    return ipcRenderer.invoke(IPC.CLI_TOOL_FIX, id)
  },

  windowMinimize(): void {
    ipcRenderer.send(IPC.WINDOW_MINIMIZE)
  },

  windowToggleMaximize(): void {
    ipcRenderer.send(IPC.WINDOW_MAXIMIZE_TOGGLE)
  },

  windowClose(): void {
    ipcRenderer.send(IPC.WINDOW_CLOSE)
  },

  windowIsMaximized(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED)
  },

  /** Enable/disable the macOS blur-behind (vibrancy); no-op elsewhere. */
  setWindowVibrancy(enabled: boolean): void {
    ipcRenderer.send(IPC.WINDOW_SET_VIBRANCY, enabled)
  },

  /** Subscribe to maximize/restore changes. Returns an unsubscribe function. */
  onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
  },

  startAgent(args: StartAgentArgs): Promise<StartAgentResult> {
    return ipcRenderer.invoke(IPC.AGENT_START, args)
  },

  /** Sessions to rebuild the UI on launch: live daemon PTYs plus restartable snapshots. */
  restoreSessions(): Promise<AgentSession[]> {
    return ipcRenderer.invoke(IPC.AGENT_RESTORE)
  },

  /** Persist a session's nickname in the daemon (survives restart). */
  updateSessionNickname(id: string, nickname: string): Promise<void> {
    return ipcRenderer.invoke(IPC.AGENT_UPDATE_META, { id, nickname })
  },

  attach(id: string): void {
    ipcRenderer.send(IPC.AGENT_ATTACH, id)
  },

  detach(id: string): void {
    ipcRenderer.send(IPC.AGENT_DETACH, id)
  },

  getTabs(): Promise<TabsState> {
    return ipcRenderer.invoke(IPC.TABS_GET)
  },

  setTabs(workspaceId: string, tabs: WorkspaceTabs): Promise<TabsState> {
    return ipcRenderer.invoke(IPC.TABS_SET, { workspaceId, tabs })
  },

  browserRequest(args: BrowserRequest): Promise<BrowserState | null> {
    return ipcRenderer.invoke(BROWSER_IPC.REQUEST, args)
  },
  sendDesign(args: BrowserDesignRequest): Promise<void> {
    return ipcRenderer.invoke(BROWSER_IPC.SEND, args)
  },
  onBrowserKey(callback: (key: BrowserKey) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, key: BrowserKey): void => callback(key)
    ipcRenderer.on(BROWSER_IPC.KEY, listener)
    return () => ipcRenderer.removeListener(BROWSER_IPC.KEY, listener)
  },
  onBrowserState(callback: (state: BrowserState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void => callback(state)
    ipcRenderer.on(BROWSER_IPC.STATE, listener)
    return () => ipcRenderer.removeListener(BROWSER_IPC.STATE, listener)
  },
  onBrowserSelection(callback: (selection: BrowserSelection) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, selection: BrowserSelection): void => callback(selection)
    ipcRenderer.on(BROWSER_IPC.SELECTION, listener)
    return () => ipcRenderer.removeListener(BROWSER_IPC.SELECTION, listener)
  },
  sendReview(args: SendReviewArgs): Promise<void> {
    return ipcRenderer.invoke(IPC.AGENT_REVIEW, args)
  },

  sendInput(id: string, data: string): void {
    ipcRenderer.send(IPC.AGENT_INPUT, { id, data })
  },

  /** Persist a pasted clipboard image to a temp file; returns its absolute path. */
  saveClipboardImage(bytes: Uint8Array, ext: string): Promise<{ path: string }> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_SAVE_IMAGE, { bytes, ext })
  },

  resize(id: string, cols: number, rows: number): void {
    ipcRenderer.send(IPC.AGENT_RESIZE, { id, cols, rows })
  },

  killAgent(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC.AGENT_KILL, id)
  },

  /** Subscribe to terminal output. Returns an unsubscribe function. */
  onAgentData(cb: (e: AgentDataEvent) => void): () => void {
    const listener = (_e: unknown, payload: AgentDataEvent): void => cb(payload)
    ipcRenderer.on(IPC.AGENT_DATA, listener)
    return () => ipcRenderer.removeListener(IPC.AGENT_DATA, listener)
  },

  /** Subscribe to process exit. Returns an unsubscribe function. */
  onAgentExit(cb: (e: AgentExitEvent) => void): () => void {
    const listener = (_e: unknown, payload: AgentExitEvent): void => cb(payload)
    ipcRenderer.on(IPC.AGENT_EXIT, listener)
    return () => ipcRenderer.removeListener(IPC.AGENT_EXIT, listener)
  },

  /** Subscribe to hook-reported agent turn state. Returns an unsubscribe function. */
  onAgentState(cb: (e: AgentStateEvent) => void): () => void {
    const listener = (_e: unknown, payload: AgentStateEvent): void => cb(payload)
    ipcRenderer.on(IPC.AGENT_STATE, listener)
    return () => ipcRenderer.removeListener(IPC.AGENT_STATE, listener)
  },

  getAgentStates(): Promise<AgentStateEvent[]> {
    return ipcRenderer.invoke(IPC.AGENT_STATES_GET)
  },

  /** Current Claude usage snapshots, to prime the store on load. */
  getUsageSnapshots(): Promise<AgentUsage[]> {
    return ipcRenderer.invoke(IPC.AGENT_USAGE_GET)
  },

  /** Subscribe to live Claude token/cost usage. Returns an unsubscribe function. */
  onAgentUsage(cb: (usage: AgentUsage) => void): () => void {
    const listener = (_e: unknown, payload: AgentUsage): void => cb(payload)
    ipcRenderer.on(IPC.AGENT_USAGE, listener)
    return () => ipcRenderer.removeListener(IPC.AGENT_USAGE, listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
