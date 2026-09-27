import type { TerminalSettings } from "./terminalSettings"
export type { TerminalSettings } from "./terminalSettings"
/**
 * 'transparent' = macOS vibrancy (blur-behind); resolves light/dark from the OS.
 * 'gradient' = the app-icon gradient painted as the window background with a
 * frosted-glass (blurred, translucent) chrome; always dark-based, all platforms.
 * 'gradient-light' = the same gradient glows over a light backdrop with light
 * translucent chrome; always light-based, all platforms.
 */
export type ThemeMode = 'light' | 'dark' | 'system' | 'transparent' | 'gradient' | 'gradient-light'

export type Language = 'en' | 'sk' | 'cs' | 'pl' | 'hu'

/** Configurable, rebindable keyboard shortcut actions. */
export type ShortcutAction =
  | 'toggleSidebar'
  | 'openSettings'
  | 'maximizeFocusedCell'
  | 'openLauncher'
  | 'toggleRightPanel'
  | 'closeFocusedCell'
  | 'closePreview'
  | 'saveFile'
  | 'toggleWorkspaceMode'
  | 'prevTerminal'
  | 'nextTerminal'
  | 'openFolder'
  | 'prevWorkspace'
  | 'nextWorkspace'
  | 'prevProfile'
  | 'nextProfile'
  | 'manageProfiles'
  | 'searchTerminal'
  | 'searchFileContents'
  | 'openPalette'

/**
 * A chord stored in a platform-neutral, normalized form: lowercase tokens
 * joined by '+', e.g. 'mod+b' or 'mod+,'. 'mod' resolves to ⌘ on macOS and
 * Ctrl elsewhere.
 */
export type ShortcutMap = Record<ShortcutAction, string>

/** Result of checking the project's GitHub releases for a newer version. */
export interface UpdateInfo {
  /** The running app version (from app.getVersion()). */
  currentVersion: string
  /** Latest published release version without a leading 'v', or null if unknown. */
  latestVersion: string | null
  /** True when latestVersion is strictly newer than currentVersion. */
  updateAvailable: boolean
  /** Web page to open to get the update (the latest release, else the list). */
  releaseUrl: string
}

/** Lifecycle phase of a user-initiated in-app update download. */
export type UpdatePhase = 'idle' | 'downloading' | 'downloaded' | 'error'

/** Progress pushed from the main process while downloading/installing an update. */
export interface UpdateProgress {
  phase: UpdatePhase
  /** Download completion, 0–100, while phase is 'downloading'. */
  percent?: number
  /** Present when phase is 'error' (e.g. the release has no update feed yet). */
  error?: string
}

export type RightPanelTab = 'files' | 'changes' | 'history' | 'tasks'

/** Persisted layout state for the left/right sidebars, restored on launch. */
export interface UiState {
  /** First-run setup was finished or explicitly skipped. */
  onboardingCompleted?: boolean
  sidebarCollapsed: boolean
  rightSidebarOpen: boolean
  /** Show workspace search, favorites, and recent shortcuts in the sidebar. */
  sidebarWorkspaceTools: boolean
  /** Last-active right-panel tab, restored on reopen. */
  rightPanelTab?: RightPanelTab
  /** Workspaces the user pinned in the sidebar. */
  favoriteWorkspaceIds?: string[]
  /** Recently visited workspaces, newest first. */
  recentWorkspaceIds?: string[]
  /** Right panel width in px (clamped to 280–560). */
  rightPanelWidth?: number
  usageFooterProfiles?: string[]
  usageFooterRemaining?: boolean
  usageFooterCompact?: boolean
}

export interface AppSettings {
  terminal: TerminalSettings
  theme: ThemeMode
  language: Language
  shortcuts: ShortcutMap
  ui: UiState
  /** Hex color a workspace tab pulses with when one of its terminals finishes. */
  attentionColor: string
  /** Global accent override; null uses the current theme's palette. */
  accentColor: string | null
  /**
   * Show live Claude usage (5h/7d limit, cost) in the terminal topbar. Off by
   * default because enabling it installs a status-line wrapper into the Claude
   * config dirs the app launches (to read the subscription rate limits).
   */
  usageTracking: boolean
  /**
   * Which figure the usage badge shows up front in the topbar. The hover
   * tooltip always lists every stat regardless of this choice.
   */
  usagePrimary: UsagePrimary
  /** Native OS notification for explicit terminal attention/exit while unfocused. */
  notifications: boolean
  /**
   * System-wide show/hide chord (app chord format, e.g. 'mod+shift+space'),
   * or null when disabled. Registered via Electron globalShortcut.
   */
  globalHotkey: string | null
  /** Editor that mod+clicked file paths in a terminal open in. */
  fileOpener: FileOpener
}

/** Account limits are scoped to a configuration directory, not a terminal session. */
export interface UsageProfile {
  id: string
  provider: 'claude' | 'codex'
  name: string
  directoryPath: string
}

export interface UsageWindow {
  id: string
  label: string
  usedPercent: number
  resetsAt: number | null
}

export interface CodexResetCredits {
  availableCount: number
  credits: { expiresAt: number | null }[] | null
}

export interface UsageResetRequest {
  profileId: string
  authFingerprint: string
  idempotencyKey: string
  confirmed: true
}

export type UsageResetOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit' | 'accountChanged' | 'unavailable' | 'busy'

export interface AccountUsage {
  resetCredits?: CodexResetCredits | null
  authFingerprint?: string
  profileId: string
  status: 'ready' | 'notSignedIn' | 'expired' | 'unavailable' | 'rateLimited' | 'noData'
  plan: string | null
  windows: UsageWindow[]
  updatedAt: number
}

/** Editors a terminal file link can open in ('system' = OS default app). */
export type FileOpener =
  | 'superior'
  | 'system'
  | 'vscode'
  | 'cursor'
  | 'zed'
  | 'sublime'
  | 'phpstorm'
  | 'webstorm'

/** A resolved file link from terminal output: absolute path + optional position. */
export interface FileLinkTarget {
  path: string
  line?: number
  column?: number
}

/** Result of opening a terminal file link. `openInApp` hands a validated path
 * back to the renderer so Superior can use its built-in preview editor. */
export interface OpenFileTargetResult {
  ok: boolean
  error?: string
  openInApp?: boolean
}

/** Result of persisting + registering the global hotkey. */
export interface GlobalHotkeyResult {
  settings: AppSettings
  /** Registration failure (taken by another app / unmappable chord). */
  error?: string
}

/** The single usage figure shown front-and-center in the topbar badge. */
export type UsagePrimary = 'remaining' | 'sevenDay' | 'cost' | 'tokens' | 'context'

export type PresetIconType = 'emoji' | 'image'

/** A user-defined terminal preset — a named command with an icon. */
export interface TerminalPreset {
  id: string
  name: string
  /** optional default nickname applied to terminals launched from this preset */
  nickname?: string
  description: string
  command: string
  iconType: PresetIconType
  /** emoji character, or an image data URL when iconType === 'image' */
  icon: string
  /** optional hex tint (e.g. '#D97757') used for the top bar while this session is active */
  color?: string
  /** active presets are shown as launch buttons in place of the defaults */
  active: boolean
  /** Stable link to a managed custom-memory preset, e.g. "claude:work". */
  customMemoryId?: string
}

export interface PresetsState {
  presets: TerminalPreset[]
}

/**
 * A saved launch layout: a grid of terminals where each slot is bound to a
 * {@link TerminalPreset} by id. Selecting one in the launcher fills the grid and
 * starts every terminal at once. Distinct from a TerminalPreset (a single command).
 */
export interface LayoutPreset {
  id: string
  name: string
  /** ordered preset ids, one per grid slot; its length is the terminal count */
  presetIds: string[]
  /**
   * Optional per-slot nicknames, aligned with {@link presetIds} by index. A blank
   * entry (or an absent array) means the slot uses its preset's own nickname.
   */
  nicknames?: string[]
  createdAt: number
}

export interface LayoutPresetsState {
  layouts: LayoutPreset[]
}

/** A saved prompt/snippet, insertable into the active terminal. */
export interface Prompt {
  id: string
  name: string
  text: string
  createdAt: number
}

export interface PromptsState {
  prompts: Prompt[]
}

/**
 * Lifecycle of a queued agent task. 'running' means a terminal session was
 * spawned for it and hasn't exited yet; 'canceled' is a user-initiated kill
 * (distinct from 'failed', a nonzero exit or a launch error).
 */
export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/**
 * One queued unit of agent work: a prompt handed to a {@link TerminalPreset}'s
 * command, optionally inside a freshly created worktree-backed workspace. Tasks
 * are scoped to a project folder; per folder they run one at a time, and the
 * next queued task starts when the previous task's terminal exits.
 */
export interface AgentTask {
  /** crypto.randomUUID() */
  id: string
  /** The project folder the task belongs to (queues are per-folder). */
  folderPath: string
  /** Prompt appended (shell-quoted) to the preset's command. */
  prompt: string
  /** The terminal preset whose command runs this task. */
  presetId: string
  /** Run in a fresh worktree-backed workspace (a new task/<slug> branch). */
  useWorktree: boolean
  /**
   * The Backlog.md task this run is about, parsed from the prompt when the task
   * was queued. Absent when the prompt named none — reporting is skipped then.
   */
  backlogTaskId?: string
  status: AgentTaskStatus
  /** The terminal session running/having run the task; set on start. */
  sessionId?: string
  /** The workspace the task ran in (the fresh worktree one, or an existing one). */
  workspaceId?: string
  /** Branch created for a worktree task; set on start. */
  branch?: string
  /** Exit code of the task's terminal; null when unknown (e.g. lost session). */
  exitCode?: number | null
  /** User-facing reason when the task failed before/while launching. */
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

/** Persisted task queue: every folder's tasks plus the global pause flag. */
export interface TasksState {
  tasks: AgentTask[]
  /** True while the queue is paused: running tasks finish, queued ones wait. */
  paused: boolean
}

export type CustomMemoryProvider = 'claude' | 'codex'

/** A provider-specific config directory discovered in the user's home folder. */
export interface CustomMemoryPreset {
  id: string
  provider: CustomMemoryProvider
  name: string
  directoryName: string
  directoryPath: string
  aliasName: string
  aliasCommand: string
  aliasExists: boolean
  aliasFiles: string[]
  terminalPresetExists: boolean
}

export interface CustomMemoryMutationResult {
  memories: CustomMemoryPreset[]
  presets: PresetsState
}

/** A CLI the built-in presets launch, checked for availability on startup. */
export type CliToolId = 'claude' | 'codex'

/**
 * Health of a CLI tool relative to the terminal this app spawns. The daemon runs
 * preset commands in a login shell (`$SHELL -l -c …`), so a CLI can be installed
 * yet still "not found" when its PATH/alias only lives in an interactive-only rc
 * file (e.g. ~/.zshrc). {@link availableInShell} reflects the shell the app uses.
 */
export interface CliToolStatus {
  id: CliToolId
  /** Display name, e.g. 'Claude'. */
  label: string
  /** The command the presets invoke, e.g. 'claude'. */
  executable: string
  /** The CLI was found somewhere on disk / in any of the user's shells. */
  installed: boolean
  /** The command resolves in the login shell the daemon launches presets with. */
  availableInShell: boolean
  /** Absolute path to the binary when discovered, else null. */
  installedPath: string | null
  /** Installed but not visible to the app's shell, and we can repair it. */
  fixable: boolean
}

/** Result of an attempted auto-fix (adding the binary's dir to the shell env file). */
export interface CliToolFixResult {
  status: CliToolStatus
  /** The shell config file that was written to (basename), when a fix was applied. */
  fixedFile?: string
  /** Stable reason code when no fix was applied: 'not-installed' | 'unsupported' | 'already-available'. */
  error?: string
}

/**
 * A named set of folders. Profiles let one user keep separate, switchable
 * collections of projects (e.g. "Work" vs "Personal"). Every install has at
 * least one profile; legacy folders are migrated into a "Default" profile.
 */
export interface Profile {
  /** crypto.randomUUID() */
  id: string
  /** user-editable display name */
  name: string
  /**
   * The workspace that was active last time this profile was selected. Restored
   * when the profile is re-activated, so switching profiles away and back keeps
   * the previous selection instead of jumping to another folder.
   */
  lastWorkspaceId?: string
  /**
   * Hex color (e.g. '#3B82F6') tinting the app title bar and the sidebar while
   * this profile is active, so the switched-to profile is recognizable at a
   * glance. Distinct from a terminal preset's color, which tints only that
   * terminal's own topbar.
   */
  color?: string
  createdAt: number
}

/** Patch for {@link Profile} visuals; a null field clears the stored value. */
export interface ProfileUpdate {
  color?: string | null
}

/** A project folder (cwd for its workspaces' terminals). */
export interface Folder {
  path: string
  /** Absent is treated as 'local' for legacy state. */
  kind?: WorkspaceFolderKind
  /** Present when kind === 'remote'. Uses the user's existing SSH config/agent. */
  remote?: RemoteWorkspaceTarget
  /** basename of path */
  name: string
  /**
   * The profile this folder belongs to. Always present in normalized state; an
   * absent value (legacy data) is migrated to the active/default profile on read.
   */
  profileId?: string
  /** User-chosen display name shown instead of `name` in the sidebar. The path is immutable. */
  displayName?: string
  /** User-uploaded custom icon as a data URL, shown instead of the default folder glyph. */
  icon?: string
  /** Hex color (e.g. '#3B82F6') tinting the folder's row background in the sidebar. */
  color?: string
  /** True when the user has rolled the folder up in the sidebar; persisted across restarts. */
  collapsed?: boolean
  lastOpenedAt: number
}

/** Patch for {@link Folder} visuals; a null field clears the stored value. */
export interface FolderUpdate {
  displayName?: string | null
  icon?: string | null
  color?: string | null
  /** Sidebar expand/collapse state. Absent leaves it untouched. */
  collapsed?: boolean
}

export type WorkspaceFolderKind = 'local' | 'remote'

export interface RemoteWorkspaceTarget {
  /** SSH alias or user@host, resolved by the system ssh client. */
  host: string
  /** Directory on the remote host. `~` and `~/...` are expanded by the remote shell. */
  path: string
}

export interface RemoteFolderAddArgs extends RemoteWorkspaceTarget {
  /** Optional sidebar label. Falls back to the remote directory name. */
  name?: string
}

export type RemoteFolderTestResult = { ok: true } | { ok: false; error: string }

/** A named working context inside a folder, owning its own terminals + layout. */
export interface Workspace {
  /** crypto.randomUUID() */
  id: string
  /** the folder this workspace belongs to (its terminals' cwd) */
  folderPath: string
  /** user-editable display name */
  name: string
  createdAt: number
  /**
   * When set, this workspace is backed by a git worktree at this absolute,
   * canonical path. Its terminals launch with cwd = worktreePath (an isolated
   * branch checkout) instead of folderPath, so parallel agents don't collide.
   * Absent on plain workspaces.
   */
  worktreePath?: string
  /** Branch checked out in the worktree (display + git ops). Absent on plain workspaces. */
  branch?: string
  /**
   * When set, selecting this workspace while it has no terminals auto-launches
   * the referenced {@link LayoutPreset}. Cleared by unchecking in the launcher;
   * a dangling id (deleted layout) is ignored.
   */
  startupLayoutId?: string
}

/** A branch (local or remote-tracking), for the branch/worktree pickers. */
export interface BranchInfo {
  /** Full short ref: `feature` for a local branch, `origin/feature` for a remote one. */
  name: string
  /** the repo's current HEAD branch */
  isCurrent: boolean
  /** already checked out in some worktree (can't be checked out again) */
  isCheckedOut: boolean
  /** true for a remote-tracking branch (from `refs/remotes`) */
  isRemote: boolean
  /** the remote name (e.g. `origin`) when {@link isRemote}; undefined for local branches */
  remote?: string
}

/** Payload to create a worktree-backed workspace. */
export interface WorktreeAddArgs {
  folderPath: string
  /** workspace display name */
  name: string
  /** branch to create (createBranch) or check out (existing) */
  branch: string
  /** true → create a new branch from HEAD; false → check out an existing branch */
  createBranch: boolean
}

/** Result of creating a worktree-backed workspace. */
export type WorktreeAddResult = WorkspaceState | { error: string }

/**
 * Stable error codes thrown by the worktree service and surfaced as `error`
 * strings over IPC. The renderer maps these to localized messages; anything
 * else (a raw git failure) is shown verbatim.
 */
export const WORKTREE_ERROR = {
  NOT_A_REPO: 'worktree:not-a-repo',
  BRANCH_EXISTS: 'worktree:branch-exists',
  BRANCH_CHECKED_OUT: 'worktree:branch-checked-out',
  INVALID_FOLDER: 'worktree:invalid-folder'
} as const
export type WorktreeErrorCode = (typeof WORKTREE_ERROR)[keyof typeof WORKTREE_ERROR]

export type AgentStatus = 'running' | 'exited' | 'error'

export interface SendReviewArgs {
  sessionId: string
  workspaceId: string
  folderPath: string
  prompt: string
}

export interface AgentSession {
  /** crypto.randomUUID() */
  id: string
  /** display label (the preset name) */
  label: string
  /** user-set nickname shown after the label; absent until the user names it */
  nickname?: string
  /** the command run in the workspace */
  command: string
  /** Where the command logically runs. Absent means local cwd from older builds. */
  launchTarget?: AgentLaunchTarget
  iconType?: PresetIconType
  icon?: string
  /** optional hex tint inherited from the launching preset, used for the top bar */
  color?: string
  /** the workspace this session belongs to */
  workspaceId: string
  /** the tab (a grid within the workspace) this session belongs to */
  tabId: string
  status: AgentStatus
  pid?: number
  exitCode?: number | null
  /** populated on spawn failure (ENOENT/EACCES/etc.) */
  error?: string
  /** last known terminal size, persisted in the daemon for replay sizing */
  cols?: number
  rows?: number
  createdAt: number
}

/** Grid cell sizing — row heights + per-row column widths as fractions. */
export interface GridLayoutData {
  rows: number[]
  cols: number[][]
  tree?: PaneNode
}

export type PaneDirection = 'left' | 'right' | 'top' | 'bottom'
export type PaneNode = { kind: 'leaf'; sessionId: string } | {
  kind: 'split'; axis: 'v' | 'h'; ratio: number; first: PaneNode; second: PaneNode
}

/** A single tab within a workspace: a named grid of terminals. */
export interface WorkspaceTab {
  id: string
  name: string
  /** saved cell sizing for this tab's grid (undefined → uniform) */
  gridLayout?: GridLayoutData
}

/** A workspace's ordered tabs plus the active one. May be empty after the last
 * tab is closed, in which case the workspace falls back to the launch wizard. */
export interface WorkspaceTabs {
  tabs: WorkspaceTab[]
  activeTabId: string
}

/** Persisted per-workspace tabs, keyed by workspace id. */
export type TabsState = Record<string, WorkspaceTabs>

/** Payload for starting an agent session from a preset. */
export interface StartAgentArgs {
  command: string
  label: string
  /** optional initial nickname, shown after the label */
  nickname?: string
  iconType?: PresetIconType
  icon?: string
  color?: string
  /** working directory (the workspace's folder path) */
  cwd: string
  /** Where to run the command. Absent means local `cwd`, preserving older callers. */
  launchTarget?: AgentLaunchTarget
  /** the workspace this session belongs to */
  workspaceId: string
  /** the tab (a grid within the workspace) this session belongs to */
  tabId: string
  cols?: number
  rows?: number
}

export type AgentLaunchTarget =
  | { kind: 'local'; cwd: string }
  | { kind: 'remote'; host: string; path: string }

/** Saved profiles + folders + their workspaces, plus the active selections. */
export interface WorkspaceState {
  /** Always non-empty in normalized state (a "Default" profile is seeded). */
  profiles: Profile[]
  /** The currently selected profile; the sidebar shows only its folders. */
  activeProfileId: string | null
  folders: Folder[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}

/** Git state for the folder backing the active workspace. */
export interface GitStatus {
  isRepository: boolean
  /** Current branch, or a short commit id while HEAD is detached. */
  branch: string | null
  /** Number of files with uncommitted changes (tracked + untracked). */
  changedFiles?: number
  /** Total added lines across the working-tree diff (incl. untracked). */
  additions?: number
  /** Total removed lines across the working-tree diff. */
  deletions?: number
  /** Commits ahead of / behind the upstream; absent without an upstream. */
  ahead?: number
  behind?: number
  /** The tracking ref (e.g. 'origin/main'), or null when none is set. */
  upstream?: string | null
  error?: string
}

/** One commit in the history view. */
export interface GitLogEntry {
  hash: string
  shortHash: string
  author: string
  /** Unix seconds of the commit time. */
  timestamp: number
  subject: string
}

/** Outcome of a mutating git action (stage, commit, push, …). */
export interface GitActionResult {
  /** User-facing error; absent on success. */
  error?: string
}

/** Outcome of switching the checked-out branch from the title-bar switcher. */
export interface BranchSwitchResult {
  /** Fresh status after a successful switch, else the unchanged current status (or null). */
  status: GitStatus | null
  /** A user-facing error when the switch failed; absent on success. */
  error?: string
  /** True when uncommitted changes block a plain checkout — the UI offers to stash. */
  dirtyConflict?: boolean
  /** True when local changes were stashed to complete the switch (recoverable via `git stash pop`). */
  stashed?: boolean
}

/** Working-tree status of a single file in a diff. */
export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

/** One line inside a diff hunk. `content` excludes the leading +/-/space marker. */
export interface GitDiffLine {
  type: 'add' | 'del' | 'context'
  content: string
  /** Line number in the old file (null for added lines). */
  oldLine: number | null
  /** Line number in the new file (null for removed lines). */
  newLine: number | null
}

/** A contiguous block of changes within a file. */
export interface GitDiffHunk {
  /** The raw `@@ -a,b +c,d @@` header. */
  header: string
  lines: GitDiffLine[]
}

/** All changes to one file relative to HEAD (or the index for fresh repos). */
export interface GitDiffFile {
  path: string
  /** Original path for renames, otherwise null. */
  oldPath: string | null
  status: GitFileStatus
  additions: number
  deletions: number
  binary: boolean
  /** Content omitted because the file is binary or too large to display. */
  truncated: boolean
  hunks: GitDiffHunk[]
}

/** One entry (file or directory) inside a listed directory. */
export interface FsEntry {
  name: string
  /** Absolute path to the entry. */
  path: string
  isDirectory: boolean
}

/** Result of listing a single directory level (children only). */
export interface FsListResult {
  entries: FsEntry[]
  /** Set when the search hit its result/visit cap and stopped early. */
  truncated?: boolean
  error?: string
}

/** One source row in the fixed-height context shown for a content match. */
export interface FileContentPreviewLine {
  /** One-based source line, or null for padding near the start/end of a file. */
  line: number | null
  /** Bounded source text safe to send across IPC. */
  text: string
}

/** One matching line returned by project-wide file-content search. */
export interface FileContentMatch {
  name: string
  /** Absolute path to the matching file. */
  path: string
  /** One-based line and column of the first match on this line. */
  line: number
  column: number
  /** Bounded single-line context around the match. */
  preview: string
  /** Match range inside `preview`, used by the renderer for highlighting. */
  matchStart: number
  matchLength: number
  /** Ten rows with the matching source line fixed at index 3 (the fourth row). */
  contextLines: FileContentPreviewLine[]
}

export interface FileContentSearchResult {
  matches: FileContentMatch[]
  /** Set when the result or visited-file limit stopped the search early. */
  truncated?: boolean
  error?: string
}

/** How to read a file for preview. */
export interface FileReadOptions {
  /** Read at most this many bytes; content beyond it is not loaded. */
  maxBytes: number
  /** Return content base64-encoded (for images) instead of utf-8 text. */
  asBase64: boolean
  /** When false, only stat the file (size) without reading any content. */
  read: boolean
}

/** File content + metadata for the preview panel. Never mutates the file. */
export interface FileReadResult {
  /** Total size on disk, in bytes. */
  size: number
  /** Modification time (ms since epoch) at read time; absent on stat errors.
      The preview editor compares it before saving to catch concurrent edits. */
  mtimeMs?: number
  /** True when the file is larger than the requested limit (content omitted/partial). */
  truncated: boolean
  /** Encoding of `content`; 'none' when nothing was read. */
  encoding: 'utf8' | 'base64' | 'none'
  content: string
  /** True when the read bytes contained a NUL, i.e. the file looks binary. */
  isBinary: boolean
  error?: string
}

/** Outcome of writing edited preview content back to disk. */
export interface FileWriteResult {
  ok: boolean
  /** New size on disk after the write, in bytes (present on success). */
  size?: number
  /** User-facing error when the write failed; absent on success. */
  error?: string
}

/** Aggregate working-tree diff for the active folder, plus per-file detail. */
export interface GitDiff {
  isRepository: boolean
  branch: string | null
  /** Unstaged changes (worktree vs index), incl. untracked files. */
  files: GitDiffFile[]
  /** Staged changes (index vs HEAD). */
  staged: GitDiffFile[]
  /** Combined totals across staged + unstaged. */
  totals: { files: number; additions: number; deletions: number }
  /** True when the untracked-file detail hit its safety cap. */
  truncated?: boolean
  /** Commits ahead of / behind the upstream; absent without an upstream. */
  ahead?: number
  behind?: number
  upstream?: string | null
  error?: string
}

/** Result returned from a start-agent request. */
export type StartAgentResult = { session: AgentSession } | { error: string }

/** main -> renderer data event payload */
export interface AgentDataEvent {
  id: string
  data: string
  /** Historical daemon scrollback replayed during attach, not fresh PTY output. */
  replay?: boolean
}

/** main -> renderer exit event payload */
export interface AgentExitEvent {
  id: string
  /** Null when the daemon disappeared and the process result is unknowable. */
  exitCode: number | null
  /** Distinguishes an unknown/disconnected process from a real process exit. */
  reason?: 'interrupted'
  /** friendly, user-facing message printed in the terminal (e.g. command-not-found) */
  message?: string
}

/**
 * Live token/cost usage for a session running a Claude CLI, derived from Claude
 * Code's own JSONL transcript for that working directory. Only emitted for
 * sessions whose command resolves to `claude` (or a `claude-*` custom-memory
 * variant); other terminals never produce this event.
 */
export interface AgentUsage {
  id: string
  /** Model id from the latest assistant turn, e.g. 'claude-opus-4-8'. */
  model: string | null
  /** Tokens occupying the context window right now (the latest turn's input). */
  contextTokens: number
  /** Context window size the percentage is measured against (200k, or 1M when exceeded). */
  contextLimit: number
  /** Cumulative non-cached input tokens billed across the session. */
  inputTokens: number
  /** Cumulative output tokens across the session. */
  outputTokens: number
  /** Cumulative cache-read input tokens across the session. */
  cacheReadTokens: number
  /** Cumulative cache-creation (write) input tokens across the session. */
  cacheCreationTokens: number
  /** Sum of the four token buckets above. */
  totalTokens: number
  /** Spend in USD — Claude's own figure when available, else a pricing estimate;
   *  null when neither is known. */
  costUsd: number | null
  /**
   * Percentage of the rolling 5-hour subscription limit already used (0–100), or
   * null when unknown. Sourced from Claude's status-line hook, so it only appears
   * for sessions launched after the status-line wrapper was installed. "Remaining"
   * is `100 - fiveHourPct`.
   */
  fiveHourPct: number | null
  /** Percentage of the rolling 7-day subscription limit used (0–100), or null. */
  sevenDayPct: number | null
  /** When the 5-hour window resets (raw value from Claude, often ISO), or null. */
  resetsAt: string | null
  /** Number of assistant turns seen in the transcript. */
  messageCount: number
  updatedAt: number
}

/** A git forge the user can connect to in order to browse/clone repositories. */
export type IntegrationProvider = 'github' | 'gitlab' | 'gitea'

/** A saved connection to a git forge: where it lives plus an access token. */
export interface Integration {
  /** crypto.randomUUID() */
  id: string
  provider: IntegrationProvider
  /** User-facing label, e.g. "Work Gitea". */
  name: string
  /**
   * Base URL of the instance, e.g. 'http://localhost:3000' or 'https://gitlab.com'.
   * For github.com it may be left blank (api.github.com is assumed).
   */
  baseUrl: string
  /** Personal access token used for API calls and authenticated clones. */
  token: string
  /** Renderer projection: true when main has a saved token; the token itself remains redacted. */
  hasToken?: boolean
}

export interface IntegrationsState {
  integrations: Integration[]
}

/** A connection draft for the test-connection check (may be unsaved, so no id). */
export interface IntegrationDraft {
  provider: IntegrationProvider
  baseUrl: string
  token: string
}

/** Outcome of a "test connection" probe against a forge's API. */
export interface IntegrationTestResult {
  ok: boolean
  /** Authenticated account name on success (login/username). */
  username?: string
  /** Stable error code (or a raw message) when ok is false. */
  error?: string
}

/** A repository returned by a forge, normalized across the three providers. */
export interface RemoteRepo {
  /** Stable id within its forge, stringified. */
  id: string
  /** Short name, e.g. 'superior'. */
  name: string
  /** Namespaced name, e.g. 'patrik/superior'. */
  fullName: string
  description: string
  /** Clean HTTPS clone URL (no embedded credentials). */
  cloneUrl: string
  private: boolean
  defaultBranch: string
}

export interface RepoListResult {
  repos: RemoteRepo[]
  /** Stable error code (or raw message) when the listing failed. */
  error?: string
}

/** Payload to clone a forge repo into a freshly-picked local directory. */
export interface CloneArgs {
  integrationId: string
  /** The repo's clean HTTPS clone URL. */
  cloneUrl: string
  /** Namespaced name, used to name the destination subfolder. */
  fullName: string
}

/** Result of a clone: updated workspace state, a user cancel, or an error code. */
export type CloneResult = { state: WorkspaceState } | { canceled: true } | { error: string }

/** State of the `superior` shell command that opens a folder in the app. */
export interface ShellCommandStatus {
  /** The command name, e.g. `superior`. */
  command: string
  /** The launcher file exists on disk. */
  installed: boolean
  /** The command resolves in the user's login shell (on PATH). */
  resolvable: boolean
  /** Absolute path to the installed launcher, or null when absent. */
  path: string | null
}

/** Outcome of installing the `superior` shell command. */
export interface ShellCommandInstallResult {
  ok: boolean
  /** Where the launcher was written. */
  path?: string
  /** The file PATH was extended in (POSIX) or 'PATH' (Windows), when a change was needed. */
  pathNote?: string
  /** Whether the command resolves right away (vs. needing a fresh shell). */
  resolvable?: boolean
  /** Error message on failure. */
  error?: string
}

/**
 * IPC channel name constants so main + preload share one source of truth.
 */
export const IPC = {
  WORKSPACE_LIST: 'workspace:list',
  PROFILE_ADD: 'profile:add',
  PROFILE_RENAME: 'profile:rename',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_REMOVE: 'profile:remove',
  PROFILE_SET_ACTIVE: 'profile:set-active',
  FOLDER_ADD: 'folder:add',
  FOLDER_ADD_REMOTE: 'folder:add-remote',
  FOLDER_REMOVE: 'folder:remove',
  FOLDER_REORDER: 'folder:reorder',
  FOLDER_UPDATE: 'folder:update',
  WORKSPACE_ADD: 'workspace:add',
  WORKSPACE_RENAME: 'workspace:rename',
  WORKSPACE_SET_STARTUP_LAYOUT: 'workspace:set-startup-layout',
  WORKSPACE_REMOVE: 'workspace:remove',
  WORKSPACE_SET_ACTIVE: 'workspace:set-active',
  WORKSPACE_ADD_WORKTREE: 'workspace:add-worktree',
  /** Main → renderer: workspace state changed out-of-band (e.g. `superior .`). */
  WORKSPACE_STATE_CHANGED: 'workspace:state-changed',
  REMOTE_WORKSPACE_TEST: 'remote-workspace:test',
  SHELL_COMMAND_STATUS: 'shell-command:status',
  SHELL_COMMAND_INSTALL: 'shell-command:install',
  WORKTREE_LIST_BRANCHES: 'worktree:list-branches',
  WORKTREE_IS_DIRTY: 'worktree:is-dirty',
  WORKTREE_SETUP_WAIT: 'worktree:setup-wait',
  WORKTREE_SETUP_GET: 'worktree:setup-get',
  WORKTREE_SETUP_SAVE: 'worktree:setup-save',
  WORKTREE_SETUP_RETRY: 'worktree:setup-retry',
  WORKTREE_SETUP_CANCEL: 'worktree:setup-cancel',
  GIT_STATUS: 'git:status',
  GIT_INIT: 'git:init',
  GIT_DIFF: 'git:diff',
  GIT_SWITCH_BRANCH: 'git:switch-branch',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_STAGE_ALL: 'git:stage-all',
  GIT_UNSTAGE_ALL: 'git:unstage-all',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_LOG: 'git:log',
  GIT_SHOW_COMMIT: 'git:show-commit',
  FS_LIST_DIR: 'fs:list-dir',
  FS_SEARCH: 'fs:search',
  FS_SEARCH_CONTENT: 'fs:search-content',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_RESOLVE_FILE_LINK: 'fs:resolve-file-link',
  FS_OPEN_FILE_TARGET: 'fs:open-file-target',
  SHELL_OPEN_PATH: 'shell:open-path',
  SETTINGS_SET_TERMINAL: 'settings:set-terminal',
  TERMINAL_CLIPBOARD_WRITE: 'terminal:clipboard-write',
  SETTINGS_SET_FILE_OPENER: 'settings:set-file-opener',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_THEME: 'settings:set-theme',
  SETTINGS_SET_LANGUAGE: 'settings:set-language',
  SETTINGS_SET_SHORTCUTS: 'settings:set-shortcuts',
  SETTINGS_SET_UI: 'settings:set-ui',
  SETTINGS_SET_ATTENTION_COLOR: 'settings:set-attention-color',
  SETTINGS_SET_ACCENT_COLOR: 'settings:set-accent-color',
  SETTINGS_SET_USAGE_TRACKING: 'settings:set-usage-tracking',
  SETTINGS_SET_NOTIFICATIONS: 'settings:set-notifications',
  SETTINGS_SET_GLOBAL_HOTKEY: 'settings:set-global-hotkey',
  NOTIFY_FINISHED: 'notify:finished',
  NOTIFY_ACTIVATED: 'notify:activated',
  APP_SET_BADGE: 'app:set-badge',
  SETTINGS_SET_USAGE_PRIMARY: 'settings:set-usage-primary',
  INTEGRATIONS_LIST: 'integrations:list',
  INTEGRATIONS_SAVE: 'integrations:save',
  INTEGRATIONS_DELETE: 'integrations:delete',
  INTEGRATIONS_TEST: 'integrations:test',
  INTEGRATIONS_LIST_REPOS: 'integrations:list-repos',
  INTEGRATIONS_CLONE: 'integrations:clone',
  PRESETS_LIST: 'presets:list',
  PRESETS_SAVE: 'presets:save',
  PRESETS_DELETE: 'presets:delete',
  PRESETS_REORDER: 'presets:reorder',
  PRESETS_SET_ACTIVE: 'presets:set-active',
  PRESETS_PICK_IMAGE: 'presets:pick-image',
  CLIPBOARD_SAVE_IMAGE: 'clipboard:save-image',
  LAYOUT_PRESETS_LIST: 'layout-presets:list',
  LAYOUT_PRESETS_SAVE: 'layout-presets:save',
  LAYOUT_PRESETS_DELETE: 'layout-presets:delete',
  PROMPTS_LIST: 'prompts:list',
  PROMPTS_SAVE: 'prompts:save',
  PROMPTS_DELETE: 'prompts:delete',
  TASKS_LIST: 'tasks:list',
  TASKS_SAVE: 'tasks:save',
  TASKS_DELETE: 'tasks:delete',
  TASKS_CLEAR_FINISHED: 'tasks:clear-finished',
  TASKS_SET_PAUSED: 'tasks:set-paused',
  CUSTOM_MEMORY_LIST: 'custom-memory:list',
  CUSTOM_MEMORY_CREATE: 'custom-memory:create',
  CUSTOM_MEMORY_ADD_ALIAS: 'custom-memory:add-alias',
  CUSTOM_MEMORY_ADD_TERMINAL_PRESET: 'custom-memory:add-terminal-preset',
  CLI_TOOLS_CHECK: 'cli-tools:check',
  CLI_TOOL_FIX: 'cli-tools:fix',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximize-toggle',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',
  WINDOW_SET_VIBRANCY: 'window:set-vibrancy',
  AGENT_START: 'agent:start',
  AGENT_INPUT: 'agent:input',
  AGENT_REVIEW: 'agent:review',
  AGENT_RESIZE: 'agent:resize',
  AGENT_KILL: 'agent:kill',
  AGENT_DATA: 'agent:data',
  AGENT_EXIT: 'agent:exit',
  AGENT_USAGE: 'agent:usage',
  AGENT_USAGE_GET: 'agent:usage-get',
  USAGE_PROFILES: 'usage:profiles',
  USAGE_ACCOUNTS: 'usage:accounts',
  USAGE_RESET: 'usage:reset',
  AGENT_RESTORE: 'agent:restore',
  AGENT_UPDATE_META: 'agent:update-meta',
  AGENT_ATTACH: 'agent:attach',
  AGENT_DETACH: 'agent:detach',
  TABS_GET: 'tabs:get',
  TABS_SET: 'tabs:set',
  UPDATE_CHECK: 'update:check',
  UPDATE_OPEN: 'update:open',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status'
} as const
