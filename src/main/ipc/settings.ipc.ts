import type { TerminalSettings } from '@shared/terminalSettings'
import { BrowserWindow, clipboard } from 'electron'
import {
  IPC,
  type AppSettings,
  type FileOpener,
  type GlobalHotkeyResult,
  type Language,
  type ShortcutMap,
  type ThemeMode,
  type UiState,
  type UsagePrimary
} from '@shared/types'
import {
  getSettings,
  setTerminalSettings,
  setAttentionColor,
  setAccentColor,
  setFileOpener,
  setGlobalHotkey,
  setLanguage,
  setNotifications,
  setAgentHooks,
  setShortcuts,
  setTheme,
  setUi,
  setUsagePrimary,
  setUsageTracking
} from '../services/settings.service'
import { applyGlobalHotkey } from '../services/global-hotkey.service'
import { syncUsageTracking } from '../services/agent.service'
import { handle } from './handle'
import { ensureClaudeStateHooks, removeAllClaudeStateHooks } from '../services/claude-hooks.service'
import { boundedString, invalidPayload, isRecord } from './validation'

const THEMES = new Set(['light', 'dark', 'system', 'transparent', 'gradient', 'gradient-light'])
const LANGUAGES = new Set(['en', 'sk', 'cs', 'pl', 'hu'])
const FILE_OPENERS = new Set(['system', 'vscode', 'cursor', 'zed', 'sublime', 'phpstorm', 'webstorm'])
const USAGE_PRIMARIES = new Set(['remaining', 'sevenDay', 'cost', 'tokens', 'context'])

export function registerSettingsIpc(getWindow: () => BrowserWindow | null): void {
  handle(IPC.SETTINGS_SET_TERMINAL, (patch: Partial<TerminalSettings>): AppSettings =>
    isRecord(patch) ? setTerminalSettings(patch) : invalidPayload()
  )
  handle(IPC.TERMINAL_CLIPBOARD_WRITE, (text: string): boolean => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 100_000) return invalidPayload()
    if (!getSettings().terminal.allowOsc52Clipboard) return false
    clipboard.writeText(text)
    return true
  })
  handle(IPC.SETTINGS_GET, (): AppSettings => getSettings())

  handle(IPC.SETTINGS_SET_THEME, (theme: ThemeMode): AppSettings =>
    typeof theme === 'string' && THEMES.has(theme) ? setTheme(theme) : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_LANGUAGE, (language: Language): AppSettings =>
    typeof language === 'string' && LANGUAGES.has(language)
      ? setLanguage(language)
      : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_SHORTCUTS, (shortcuts: ShortcutMap): AppSettings =>
    isRecord(shortcuts) ? setShortcuts(shortcuts as ShortcutMap) : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_UI, (ui: Partial<UiState>): AppSettings =>
    isRecord(ui) ? setUi(ui) : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_FILE_OPENER, (opener: FileOpener): AppSettings =>
    typeof opener === 'string' && FILE_OPENERS.has(opener)
      ? setFileOpener(opener)
      : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_ATTENTION_COLOR, (color: string): AppSettings =>
    boundedString(color, 32) ? setAttentionColor(color) : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_ACCENT_COLOR, (color: string | null): AppSettings =>
    color === null || (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
      ? setAccentColor(color)
      : invalidPayload()
  )

  handle(
    IPC.SETTINGS_SET_USAGE_TRACKING,
    async (enabled: boolean): Promise<AppSettings> => {
      if (typeof enabled !== 'boolean') return invalidPayload()
      const settings = setUsageTracking(enabled)
      await syncUsageTracking(settings.usageTracking)
      return settings
    }
  )

  handle(IPC.SETTINGS_SET_USAGE_PRIMARY, (primary: UsagePrimary): AppSettings =>
    typeof primary === 'string' && USAGE_PRIMARIES.has(primary)
      ? setUsagePrimary(primary)
      : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_NOTIFICATIONS, (enabled: boolean): AppSettings =>
    typeof enabled === 'boolean' ? setNotifications(enabled) : invalidPayload()
  )

  handle(IPC.SETTINGS_SET_AGENT_HOOKS, (enabled: boolean): AppSettings => {
    if (typeof enabled !== 'boolean') return invalidPayload()
    const next = setAgentHooks(enabled)
    // Claude reads hooks at startup, so this applies to newly launched sessions.
    if (enabled) ensureClaudeStateHooks('claude')
    else removeAllClaudeStateHooks()
    return next
  })

  // Try to register first; only persist a chord that actually took effect.
  // The hotkey callback outlives windows — it must resolve the CURRENT window
  // through the shared getter, not a webContents captured from the request
  // (which pins a destroyed window after close + re-create and goes silent).
  handle(
    IPC.SETTINGS_SET_GLOBAL_HOTKEY,
    (chord: string | null): GlobalHotkeyResult => {
      if (chord !== null && !boundedString(chord, 256)) return invalidPayload()
      const error = applyGlobalHotkey(chord, getWindow)
      if (error) {
        // Fall back to the previously working registration (if any).
        applyGlobalHotkey(getSettings().globalHotkey, getWindow)
        return { settings: getSettings(), error }
      }
      return { settings: setGlobalHotkey(chord) }
    }
  )
}
