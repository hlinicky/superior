import { DEFAULT_TERMINAL_SETTINGS, normalizeTerminalSettings, type TerminalSettings } from '@shared/terminalSettings'
import type {
  AppSettings,
  FileOpener,
  Language,
  ShortcutAction,
  ShortcutMap,
  ThemeMode,
  UiState,
  UsagePrimary
} from '@shared/types'
import { readJsonFile, userDataFile, writeJsonFile } from '../lib/jsonStore'

const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleSidebar: 'mod+b',
  openSettings: 'mod+,',
  maximizeFocusedCell: 'ctrl+enter',
  openLauncher: 'mod+t',
  toggleRightPanel: 'mod+j',
  closeFocusedCell: 'mod+w',
  closePreview: 'mod+shift+w',
  saveFile: 'mod+s',
  toggleWorkspaceMode: 'mod+shift+e',
  prevTerminal: 'mod+alt+arrowleft',
  nextTerminal: 'mod+alt+arrowright',
  openFolder: 'mod+o',
  prevWorkspace: 'mod+shift+arrowup',
  nextWorkspace: 'mod+shift+arrowdown',
  prevProfile: 'mod+shift+arrowleft',
  nextProfile: 'mod+shift+arrowright',
  manageProfiles: 'mod+shift+p',
  searchTerminal: 'mod+f',
  searchFileContents: 'mod+shift+f',
  openPalette: 'mod+k'
}
const SHORTCUT_ACTIONS: ShortcutAction[] = [
  'toggleSidebar',
  'openSettings',
  'maximizeFocusedCell',
  'openLauncher',
  'toggleRightPanel',
  'closeFocusedCell',
  'closePreview',
  'saveFile',
  'toggleWorkspaceMode',
  'prevTerminal',
  'nextTerminal',
  'openFolder',
  'prevWorkspace',
  'nextWorkspace',
  'prevProfile',
  'nextProfile',
  'manageProfiles',
  'searchTerminal',
  'searchFileContents',
  'openPalette'
]
const DEFAULT_UI: UiState = {
  onboardingCompleted: false,
  sidebarCollapsed: false,
  rightSidebarOpen: false,
  sidebarWorkspaceTools: false
}
/** Catppuccin peach — a warm "done" tint that reads against the dark UI. */
const DEFAULT_ATTENTION_COLOR = '#fab387'
const DEFAULTS: AppSettings = {
  terminal: { ...DEFAULT_TERMINAL_SETTINGS },
  theme: 'light',
  language: 'en',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  ui: { ...DEFAULT_UI },
  attentionColor: DEFAULT_ATTENTION_COLOR,
  accentColor: null,
  usageTracking: false,
  usagePrimary: 'remaining',
  notifications: true,
  agentHooks: true,
  globalHotkey: null,
  fileOpener: 'system'
}
const THEMES: ThemeMode[] = ['light', 'dark', 'system', 'transparent', 'gradient', 'gradient-light']
const LANGUAGES: Language[] = ['en', 'sk', 'cs', 'pl', 'hu']
const USAGE_PRIMARIES: UsagePrimary[] = ['remaining', 'sevenDay', 'cost', 'tokens', 'context']
const FILE_OPENERS: FileOpener[] = [
  'superior',
  'system',
  'vscode',
  'cursor',
  'zed',
  'sublime',
  'phpstorm',
  'webstorm'
]

/**
 * Chords that used to be shipped defaults. A stored value matching its action's
 * retired default was never a deliberate user choice (the full map is persisted
 * on any rebind), so it upgrades to the current default instead of sticking.
 */
const RETIRED_DEFAULTS: Partial<Record<ShortcutAction, string[]>> = {
  openLauncher: ['ctrl+§'],
  prevTerminal: ['ctrl+arrowleft'],
  nextTerminal: ['ctrl+arrowright']
}

/** Merge stored shortcuts over the defaults, dropping unknown actions and non-string chords. */
function normalizeShortcuts(raw: unknown): ShortcutMap {
  const next: ShortcutMap = { ...DEFAULT_SHORTCUTS }
  if (raw && typeof raw === 'object') {
    for (const action of SHORTCUT_ACTIONS) {
      const value = (raw as Record<string, unknown>)[action]
      if (typeof value === 'string' && value.trim() && !RETIRED_DEFAULTS[action]?.includes(value))
        next[action] = value
    }
  }
  return next
}

const RIGHT_PANEL_TABS = ['files', 'changes', 'history', 'tasks']

/** Coerce stored UI layout flags to booleans, falling back to defaults. */
function normalizeUi(raw: unknown): UiState {
  const next: UiState = { ...DEFAULT_UI }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.onboardingCompleted === 'boolean') next.onboardingCompleted = obj.onboardingCompleted
    if (typeof obj.sidebarCollapsed === 'boolean') next.sidebarCollapsed = obj.sidebarCollapsed
    if (typeof obj.rightSidebarOpen === 'boolean') next.rightSidebarOpen = obj.rightSidebarOpen
    if (typeof obj.sidebarWorkspaceTools === 'boolean')
      next.sidebarWorkspaceTools = obj.sidebarWorkspaceTools
    if (typeof obj.rightPanelTab === 'string' && RIGHT_PANEL_TABS.includes(obj.rightPanelTab))
      next.rightPanelTab = obj.rightPanelTab as UiState['rightPanelTab']
    const normalizeIds = (value: unknown, limit: number): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const ids = value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      return [...new Set(ids)].slice(0, limit)
    }
    next.favoriteWorkspaceIds = normalizeIds(obj.favoriteWorkspaceIds, 200)
    next.recentWorkspaceIds = normalizeIds(obj.recentWorkspaceIds, 12)
    next.usageFooterProfiles = normalizeIds(obj.usageFooterProfiles, 100)
    if (typeof obj.usageFooterRemaining === 'boolean') next.usageFooterRemaining = obj.usageFooterRemaining
    if (typeof obj.usageFooterCompact === 'boolean') next.usageFooterCompact = obj.usageFooterCompact
    if (['recent', 'smart', 'name', 'manual'].includes(obj.workspaceSort as string))
      next.workspaceSort = obj.workspaceSort as UiState['workspaceSort']
    next.workspaceOrder = normalizeIds(obj.workspaceOrder, 2000)
    if (obj.workspaceActivity && typeof obj.workspaceActivity === 'object' && !Array.isArray(obj.workspaceActivity)) {
      const entries = Object.entries(obj.workspaceActivity as Record<string, unknown>)
        .filter((entry): entry is [string, number] => entry[0].length <= 200 && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 500)
      next.workspaceActivity = Object.fromEntries(entries)
    }
    if (typeof obj.elevationWarningDismissed === 'boolean')
      next.elevationWarningDismissed = obj.elevationWarningDismissed
    if (typeof obj.rightPanelWidth === 'number' && Number.isFinite(obj.rightPanelWidth))
      next.rightPanelWidth = Math.min(560, Math.max(280, Math.round(obj.rightPanelWidth)))
  }
  return next
}

/** Accept only a valid #rgb / #rrggbb hex color, else fall back to the default. */
function normalizeColor(raw: unknown): string {
  return typeof raw === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.trim())
    ? raw.trim().toLowerCase()
    : DEFAULT_ATTENTION_COLOR
}

function storeFile(): string {
  return userDataFile('settings.json')
}

// Settings are only ever written through this module, so the parsed value can
// live in memory — getSettings is called from pollers and every setter, and
// re-reading the file each time was a sync fs hit on the main thread.
let cached: AppSettings | null = null

/** JSON may be syntactically valid yet still be an unusable primitive or array. */
function isSettingsRecord(value: unknown): value is Partial<AppSettings> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Read persisted settings, falling back to defaults for any missing/invalid field. */
export function getSettings(): AppSettings {
  if (cached) return cached
  const parsed = readJsonFile<Partial<AppSettings>>(storeFile(), {}, (value) =>
    isSettingsRecord(value) ? value : null
  )
  cached = {
    terminal: normalizeTerminalSettings(parsed.terminal),
    theme: THEMES.includes(parsed.theme as ThemeMode) ? (parsed.theme as ThemeMode) : DEFAULTS.theme,
    language: LANGUAGES.includes(parsed.language as Language)
      ? (parsed.language as Language)
      : DEFAULTS.language,
    shortcuts: normalizeShortcuts(parsed.shortcuts),
    // Existing installations predate the wizard. Preserve their preferences and
    // offer replay in Settings; only a fresh store starts setup automatically.
    ui: {
      ...normalizeUi(parsed.ui),
      onboardingCompleted: typeof parsed.ui?.onboardingCompleted === 'boolean'
        ? parsed.ui.onboardingCompleted
        : Object.keys(parsed).length > 0
    },
    attentionColor: normalizeColor(parsed.attentionColor),
    accentColor: normalizeAccentColor(parsed.accentColor),
    usageTracking:
      typeof parsed.usageTracking === 'boolean' ? parsed.usageTracking : DEFAULTS.usageTracking,
    usagePrimary: USAGE_PRIMARIES.includes(parsed.usagePrimary as UsagePrimary)
      ? (parsed.usagePrimary as UsagePrimary)
      : DEFAULTS.usagePrimary,
    notifications:
      typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULTS.notifications,
    agentHooks: typeof parsed.agentHooks === 'boolean' ? parsed.agentHooks : DEFAULTS.agentHooks,
    globalHotkey:
      typeof parsed.globalHotkey === 'string' && parsed.globalHotkey.trim()
        ? parsed.globalHotkey
        : null,
    fileOpener: FILE_OPENERS.includes(parsed.fileOpener as FileOpener)
      ? (parsed.fileOpener as FileOpener)
      : DEFAULTS.fileOpener
  }
  return cached
}

function save(settings: AppSettings): void {
  writeJsonFile(storeFile(), settings, 'settings')
  cached = settings
}

/** Persist the theme mode and return the updated settings. */
export function setTheme(theme: ThemeMode): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    theme: THEMES.includes(theme) ? theme : DEFAULTS.theme
  }
  save(next)
  return next
}

/** Persist the interface language and return the updated settings. */
export function setLanguage(language: Language): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language
  }
  save(next)
  return next
}

/** Persist the keyboard shortcut map (merged over defaults) and return updated settings. */
export function setShortcuts(shortcuts: ShortcutMap): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    shortcuts: normalizeShortcuts(shortcuts)
  }
  save(next)
  return next
}

/** Persist the sidebar layout state (merged over the stored state, so partial
 * updates from different components don't clobber each other's fields). */
export function setUi(ui: Partial<UiState>): AppSettings {
  const current = getSettings()
  const next: AppSettings = {
    ...current,
    ui: normalizeUi({
      ...current.ui,
      ...ui,
      onboardingCompleted: typeof ui.onboardingCompleted === 'boolean'
        ? ui.onboardingCompleted
        : current.ui.onboardingCompleted
    })
  }
  save(next)
  return next
}

/** Persist the workspace-attention pulse color and return the updated settings. */
export function setAttentionColor(color: string): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    attentionColor: normalizeColor(color)
  }
  save(next)
  return next
}

function normalizeAccentColor(color: unknown): string | null {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : null
}

export function setAccentColor(color: string | null): AppSettings {
  const next: AppSettings = { ...getSettings(), accentColor: normalizeAccentColor(color) }
  save(next)
  return next
}

/** Persist whether Claude usage tracking is enabled and return the updated settings. */
export function setUsageTracking(enabled: boolean): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    usageTracking: Boolean(enabled)
  }
  save(next)
  return next
}

/** Persist whether finished-agent OS notifications are enabled. */
export function setNotifications(enabled: boolean): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    notifications: Boolean(enabled)
  }
  save(next)
  return next
}

/** Persist whether Claude state hooks are installed. */
export function setAgentHooks(enabled: boolean): AppSettings {
  const next: AppSettings = { ...getSettings(), agentHooks: Boolean(enabled) }
  save(next)
  return next
}

/** Persist the global show/hide hotkey chord (null = disabled). */
export function setGlobalHotkey(chord: string | null): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    globalHotkey: typeof chord === 'string' && chord.trim() ? chord : null
  }
  save(next)
  return next
}

/** Persist which editor terminal file links open in. */
export function setFileOpener(opener: FileOpener): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    fileOpener: FILE_OPENERS.includes(opener) ? opener : DEFAULTS.fileOpener
  }
  save(next)
  return next
}

/** Persist which figure the usage badge leads with and return the updated settings. */
export function setUsagePrimary(primary: UsagePrimary): AppSettings {
  const next: AppSettings = {
    ...getSettings(),
    usagePrimary: USAGE_PRIMARIES.includes(primary) ? primary : DEFAULTS.usagePrimary
  }
  save(next)
  return next
}

/** Merge a terminal patch against the latest persisted preferences. */
export function setTerminalSettings(patch: Partial<TerminalSettings>): AppSettings {
  const current = getSettings()
  const next = { ...current, terminal: normalizeTerminalSettings(patch, current.terminal) }
  save(next)
  return next
}
