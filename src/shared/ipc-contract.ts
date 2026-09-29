import type { WorktreeSetupConfig, WorktreeSetupSnapshot } from './worktree-setup'
import type { TerminalSettings } from './terminalSettings'
import { BROWSER_IPC, type BrowserRequest, type BrowserState, type BrowserDesignRequest } from './browser'
import { IPC } from './types'
import type { AgentStateEvent } from './agent-state'
import type {
  SendReviewArgs,
  AgentTask,
  AgentSession,
  AgentUsage,
  AccountUsage,
  UsageResetRequest,
  UsageResetOutcome,
  UsageProfile,
  AppSettings,
  BranchInfo,
  BranchSwitchResult,
  CliToolFixResult,
  CliToolId,
  CliToolStatus,
  CloneArgs,
  CloneResult,
  CustomMemoryMutationResult,
  CustomMemoryPreset,
  CustomMemoryProvider,
  FileLinkTarget,
  FileContentSearchResult,
  FileOpener,
  OpenFileTargetResult,
  FileReadOptions,
  FileReadResult,
  FileWriteResult,
  FolderUpdate,
  FsListResult,
  GitActionResult,
  GitDiff,
  GitDiffFile,
  GitLogEntry,
  GitStatus,
  GlobalHotkeyResult,
  Integration,
  IntegrationDraft,
  IntegrationsState,
  IntegrationTestResult,
  Language,
  LayoutPreset,
  LayoutPresetsState,
  PresetsState,
  ProfileUpdate,
  Prompt,
  PromptsState,
  RemoteFolderAddArgs,
  RemoteFolderTestResult,
  RemoteWorkspaceTarget,
  RepoListResult,
  ShellCommandInstallResult,
  ShellCommandStatus,
  ShortcutMap,
  StartAgentArgs,
  StartAgentResult,
  TabsState,
  TasksState,
  TerminalPreset,
  ThemeMode,
  UiState,
  UpdateInfo,
  UsagePrimary,
  WorkspaceState,
  WorkspaceTabs,
  WorktreeAddArgs,
  WorktreeAddResult
} from './types'

interface Invocation<Args extends unknown[], Result> {
  args: Args
  result: Result
}

/**
 * Typed contract for every renderer → main invoke channel. The preload keeps
 * its explicit, capability-limited API; this map makes the channel payload and
 * result a single source of truth for both that API and main-process handlers.
 */
export interface IpcInvokeMap {
  [IPC.WORKSPACE_LIST]: Invocation<[], WorkspaceState>
  [IPC.PROFILE_ADD]: Invocation<[name: string], WorkspaceState>
  [IPC.PROFILE_RENAME]: Invocation<[args: { id: string; name: string }], WorkspaceState>
  [IPC.PROFILE_UPDATE]: Invocation<[args: { id: string; patch: ProfileUpdate }], WorkspaceState>
  [IPC.PROFILE_REMOVE]: Invocation<[id: string], WorkspaceState>
  [IPC.PROFILE_SET_ACTIVE]: Invocation<[id: string], WorkspaceState>
  [IPC.FOLDER_ADD]: Invocation<[], WorkspaceState | null | { error: string }>
  [IPC.FOLDER_ADD_REMOTE]: Invocation<
    [args: RemoteFolderAddArgs],
    WorkspaceState | { error: string }
  >
  [IPC.REMOTE_WORKSPACE_TEST]: Invocation<[args: RemoteWorkspaceTarget], RemoteFolderTestResult>
  [IPC.FOLDER_REMOVE]: Invocation<[folderPath: string], WorkspaceState>
  [IPC.FOLDER_REORDER]: Invocation<[orderedPaths: string[]], WorkspaceState>
  [IPC.FOLDER_UPDATE]: Invocation<
    [args: { folderPath: string; patch: FolderUpdate }],
    WorkspaceState
  >
  [IPC.WORKSPACE_ADD]: Invocation<
    [args: { folderPath: string; name: string }],
    WorkspaceState
  >
  [IPC.WORKSPACE_RENAME]: Invocation<[args: { id: string; name: string }], WorkspaceState>
  [IPC.WORKSPACE_SET_STARTUP_LAYOUT]: Invocation<
    [args: { id: string; layoutId: string | null }],
    WorkspaceState
  >
  [IPC.WORKSPACE_REMOVE]: Invocation<[args: { id: string; force?: boolean }], WorkspaceState>
  [IPC.WORKSPACE_SET_ACTIVE]: Invocation<[id: string], WorkspaceState>
  [IPC.WORKSPACE_ADD_WORKTREE]: Invocation<[args: WorktreeAddArgs], WorktreeAddResult>

  [IPC.SHELL_COMMAND_STATUS]: Invocation<[], ShellCommandStatus>
  [IPC.SHELL_COMMAND_INSTALL]: Invocation<[], ShellCommandInstallResult>
  [IPC.WORKTREE_LIST_BRANCHES]: Invocation<[folderPath: string], BranchInfo[]>
  [IPC.WORKTREE_SETUP_WAIT]: Invocation<[workspaceId: string], void>
  [IPC.WORKTREE_SETUP_GET]: Invocation<[workspaceId: string], WorktreeSetupSnapshot>
  [IPC.WORKTREE_SETUP_SAVE]: Invocation<[workspaceId: string, config: WorktreeSetupConfig], void>
  [IPC.WORKTREE_SETUP_RETRY]: Invocation<[workspaceId: string], void>
  [IPC.WORKTREE_SETUP_CANCEL]: Invocation<[workspaceId: string], void>
  [IPC.WORKTREE_IS_DIRTY]: Invocation<[worktreePath: string], boolean>

  [IPC.GIT_STATUS]: Invocation<[folderPath: string], GitStatus>
  [IPC.GIT_INIT]: Invocation<[folderPath: string], GitStatus>
  [IPC.GIT_DIFF]: Invocation<[folderPath: string], GitDiff>
  [IPC.GIT_SWITCH_BRANCH]: Invocation<
    [args: { folderPath: string; branch: string; opts?: { stash?: boolean } }],
    BranchSwitchResult
  >
  [IPC.GIT_CREATE_BRANCH]: Invocation<
    [args: { folderPath: string; branch: string }],
    BranchSwitchResult
  >
  [IPC.GIT_STAGE]: Invocation<[args: { folderPath: string; path: string }], GitActionResult>
  [IPC.GIT_UNSTAGE]: Invocation<[args: { folderPath: string; path: string }], GitActionResult>
  [IPC.GIT_STAGE_ALL]: Invocation<[folderPath: string], GitActionResult>
  [IPC.GIT_UNSTAGE_ALL]: Invocation<[folderPath: string], GitActionResult>
  [IPC.GIT_COMMIT]: Invocation<
    [args: { folderPath: string; message: string }],
    GitActionResult
  >
  [IPC.GIT_PUSH]: Invocation<[folderPath: string], GitActionResult>
  [IPC.GIT_PULL]: Invocation<[folderPath: string], GitActionResult>
  [IPC.GIT_LOG]: Invocation<[folderPath: string, limit?: number], GitLogEntry[]>
  [IPC.GIT_SHOW_COMMIT]: Invocation<[args: { folderPath: string; hash: string }], GitDiffFile[]>

  [IPC.FS_LIST_DIR]: Invocation<[dirPath: string], FsListResult>
  [IPC.FS_SEARCH]: Invocation<[rootPath: string, query: string], FsListResult>
  [IPC.FS_SEARCH_CONTENT]: Invocation<
    [rootPath: string, query: string],
    FileContentSearchResult
  >
  [IPC.FS_READ_FILE]: Invocation<[filePath: string, options: FileReadOptions], FileReadResult>
  [IPC.FS_WRITE_FILE]: Invocation<[filePath: string, content: string], FileWriteResult>
  [IPC.SHELL_OPEN_PATH]: Invocation<[filePath: string], string>
  [IPC.FS_RESOLVE_FILE_LINK]: Invocation<
    [cwd: string | null, token: string],
    FileLinkTarget | null
  >
  [IPC.FS_OPEN_FILE_TARGET]: Invocation<
    [target: FileLinkTarget],
    OpenFileTargetResult
  >

  [IPC.SETTINGS_SET_TERMINAL]: Invocation<[patch: Partial<TerminalSettings>], AppSettings>
  [IPC.TERMINAL_CLIPBOARD_WRITE]: Invocation<[text: string], boolean>
  [IPC.SETTINGS_GET]: Invocation<[], AppSettings>
  [IPC.SETTINGS_SET_THEME]: Invocation<[theme: ThemeMode], AppSettings>
  [IPC.SETTINGS_SET_LANGUAGE]: Invocation<[language: Language], AppSettings>
  [IPC.SETTINGS_SET_SHORTCUTS]: Invocation<[shortcuts: ShortcutMap], AppSettings>
  [IPC.SETTINGS_SET_UI]: Invocation<[ui: Partial<UiState>], AppSettings>
  [IPC.SETTINGS_SET_FILE_OPENER]: Invocation<[opener: FileOpener], AppSettings>
  [IPC.SETTINGS_SET_ATTENTION_COLOR]: Invocation<[color: string], AppSettings>
  [IPC.SETTINGS_SET_ACCENT_COLOR]: Invocation<[color: string | null], AppSettings>
  [IPC.SETTINGS_SET_USAGE_TRACKING]: Invocation<[enabled: boolean], AppSettings>
  [IPC.SETTINGS_SET_USAGE_PRIMARY]: Invocation<[primary: UsagePrimary], AppSettings>
  [IPC.SETTINGS_SET_NOTIFICATIONS]: Invocation<[enabled: boolean], AppSettings>
  [IPC.SETTINGS_SET_AGENT_HOOKS]: Invocation<[enabled: boolean], AppSettings>
  [IPC.SETTINGS_SET_GLOBAL_HOTKEY]: Invocation<[chord: string | null], GlobalHotkeyResult>

  [IPC.UPDATE_CHECK]: Invocation<[], UpdateInfo>
  [IPC.UPDATE_OPEN]: Invocation<[url: string], void>
  [IPC.UPDATE_DOWNLOAD]: Invocation<[], void>
  [IPC.UPDATE_INSTALL]: Invocation<[], void>

  [IPC.INTEGRATIONS_LIST]: Invocation<[], IntegrationsState>
  [IPC.INTEGRATIONS_SAVE]: Invocation<[integration: Integration], IntegrationsState>
  [IPC.INTEGRATIONS_DELETE]: Invocation<[id: string], IntegrationsState>
  [IPC.INTEGRATIONS_TEST]: Invocation<[draft: IntegrationDraft], IntegrationTestResult>
  [IPC.INTEGRATIONS_LIST_REPOS]: Invocation<[integrationId: string], RepoListResult>
  [IPC.INTEGRATIONS_CLONE]: Invocation<[args: CloneArgs], CloneResult>

  [IPC.PRESETS_LIST]: Invocation<[], PresetsState>
  [IPC.PRESETS_SAVE]: Invocation<[preset: TerminalPreset], PresetsState>
  [IPC.PRESETS_DELETE]: Invocation<[id: string], PresetsState>
  [IPC.PRESETS_REORDER]: Invocation<[orderedIds: string[]], PresetsState>
  [IPC.PRESETS_SET_ACTIVE]: Invocation<[args: { id: string; active: boolean }], PresetsState>
  [IPC.PRESETS_PICK_IMAGE]: Invocation<[], { dataUrl: string } | null>
  [IPC.LAYOUT_PRESETS_LIST]: Invocation<[], LayoutPresetsState>
  [IPC.LAYOUT_PRESETS_SAVE]: Invocation<[layout: LayoutPreset], LayoutPresetsState>
  [IPC.LAYOUT_PRESETS_DELETE]: Invocation<[id: string], LayoutPresetsState>
  [IPC.CUSTOM_MEMORY_LIST]: Invocation<[], CustomMemoryPreset[]>
  [IPC.CUSTOM_MEMORY_CREATE]: Invocation<
    [args: { provider: CustomMemoryProvider; name: string }],
    CustomMemoryMutationResult
  >
  [IPC.CUSTOM_MEMORY_ADD_ALIAS]: Invocation<[directoryName: string], CustomMemoryPreset[]>
  [IPC.CUSTOM_MEMORY_ADD_TERMINAL_PRESET]: Invocation<
    [directoryName: string],
    CustomMemoryMutationResult
  >
  [IPC.CLI_TOOLS_CHECK]: Invocation<[force?: boolean], CliToolStatus[]>
  [IPC.CLI_TOOL_FIX]: Invocation<[id: CliToolId], CliToolFixResult>

  [IPC.PROMPTS_LIST]: Invocation<[], PromptsState>
  [IPC.PROMPTS_SAVE]: Invocation<[prompt: Prompt], PromptsState>
  [IPC.PROMPTS_DELETE]: Invocation<[id: string], PromptsState>
  [IPC.TASKS_LIST]: Invocation<[], TasksState>
  [IPC.TASKS_SAVE]: Invocation<[task: AgentTask], TasksState>
  [IPC.TASKS_DELETE]: Invocation<[id: string], TasksState>
  [IPC.TASKS_CLEAR_FINISHED]: Invocation<[folderPath: string], TasksState>
  [IPC.TASKS_SET_PAUSED]: Invocation<[paused: boolean], TasksState>

  [IPC.WINDOW_IS_MAXIMIZED]: Invocation<[], boolean>
  [IPC.APP_IS_ELEVATED]: Invocation<[], boolean>
  [IPC.AGENT_START]: Invocation<[args: StartAgentArgs], StartAgentResult>
  [IPC.AGENT_REVIEW]: Invocation<[SendReviewArgs], void>
  [BROWSER_IPC.REQUEST]: Invocation<[BrowserRequest], BrowserState | null>
  [BROWSER_IPC.SEND]: Invocation<[BrowserDesignRequest], void>
  [IPC.AGENT_RESTORE]: Invocation<[], AgentSession[]>
  [IPC.AGENT_UPDATE_META]: Invocation<[args: { id: string; nickname: string }], void>
  [IPC.AGENT_KILL]: Invocation<[id: string], void>
  [IPC.AGENT_USAGE_GET]: Invocation<[], AgentUsage[]>
  [IPC.AGENT_STATES_GET]: Invocation<[], AgentStateEvent[]>
  [IPC.USAGE_PROFILES]: Invocation<[], UsageProfile[]>
  [IPC.USAGE_ACCOUNTS]: Invocation<[ids: string[], force: boolean], AccountUsage[]>
  [IPC.USAGE_RESET]: Invocation<[request: UsageResetRequest], UsageResetOutcome>
  [IPC.TABS_GET]: Invocation<[], TabsState>
  [IPC.TABS_SET]: Invocation<[args: { workspaceId: string; tabs: WorkspaceTabs }], TabsState>
  [IPC.CLIPBOARD_SAVE_IMAGE]: Invocation<
    [payload: { bytes: Uint8Array; ext: string }],
    { path: string }
  >
}

export type IpcInvokeChannel = keyof IpcInvokeMap

export type IpcInvokeArgs<Channel extends IpcInvokeChannel> = IpcInvokeMap[Channel]['args']

export type IpcInvokeResult<Channel extends IpcInvokeChannel> = IpcInvokeMap[Channel]['result']
