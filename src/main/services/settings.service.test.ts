import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ getPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: electron.getPath } }))

describe('first-run preferences and onboarding', () => {
  let userData: string
  beforeEach(() => {
    vi.resetModules()
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-onboarding-'))
    electron.getPath.mockReturnValue(userData)
  })
  afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }) })

  it('starts a fresh installation in Light with setup pending', async () => {
    const settings = await import('./settings.service')
    expect(settings.getSettings()).toMatchObject({ theme: 'light', language: 'en', ui: { onboardingCompleted: false } })
  })

  it('preserves an existing installation’s theme and does not force setup on upgrade', async () => {
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'gradient-light', language: 'sk', ui: { sidebarCollapsed: true } }))
    const settings = await import('./settings.service')
    expect(settings.getSettings()).toMatchObject({ theme: 'gradient-light', language: 'sk', ui: { sidebarCollapsed: true, onboardingCompleted: true } })
  })

  it('resumes unfinished setup after saving language and theme and restarting', async () => {
    const settings = await import('./settings.service')
    settings.setLanguage('sk')
    settings.setTheme('dark')
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings()).toMatchObject({ language: 'sk', theme: 'dark', ui: { onboardingCompleted: false } })
  })

  it('persists completion/skip across restart without losing unrelated UI preferences', async () => {
    const settings = await import('./settings.service')
    settings.setUi({ favoriteWorkspaceIds: ['pinned'], usageFooterProfiles: ['claude:work'], rightPanelWidth: 420 })
    settings.setUi({ onboardingCompleted: true })
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings().ui).toMatchObject({ onboardingCompleted: true, favoriteWorkspaceIds: ['pinned'], usageFooterProfiles: ['claude:work'], rightPanelWidth: 420 })
    restarted.setUi({ rightSidebarOpen: true })
    expect(restarted.getSettings().ui.onboardingCompleted).toBe(true)
  })

  it('keeps setup pending when saving completion fails', async () => {
    const settings = await import('./settings.service')
    expect(settings.getSettings().ui.onboardingCompleted).toBe(false)
    fs.mkdirSync(path.join(userData, 'settings.json'))
    expect(() => settings.setUi({ onboardingCompleted: true })).toThrow('Failed to persist settings')
    expect(settings.getSettings().ui.onboardingCompleted).toBe(false)
  })

  it('cannot lose a completed marker to an invalid preference patch', async () => {
    const settings = await import('./settings.service')
    settings.setUi({ onboardingCompleted: true })
    // Main IPC accepts an object, while normalization enforces field types.
    settings.setUi({ onboardingCompleted: 'no' } as never)
    expect(settings.getSettings().ui.onboardingCompleted).toBe(true)
  })
  it('persists the administrator warning opt-out and falls back to warning on invalid values', async () => {
    const settings = await import('./settings.service')
    expect(settings.getSettings().ui.elevationWarningDismissed).toBeUndefined()
    settings.setUi({ elevationWarningDismissed: true })
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings().ui.elevationWarningDismissed).toBe(true)
    restarted.setUi({ elevationWarningDismissed: 'yes' } as never)
    expect(restarted.getSettings().ui.elevationWarningDismissed).toBeUndefined()
  })
  it('persists workspace sorting, manual order and activity, dropping invalid values', async () => {
    const settings = await import('./settings.service')
    settings.setUi({ workspaceSort: 'manual', workspaceOrder: ['b', 'a', 'b', ''], workspaceActivity: { a: 5, b: Number.NaN } })
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings().ui).toMatchObject({ workspaceSort: 'manual', workspaceOrder: ['b', 'a'], workspaceActivity: { a: 5 } })
    restarted.setUi({ workspaceSort: 'random' } as never)
    expect(restarted.getSettings().ui.workspaceSort).toBeUndefined()
  })
  it('persists terminal patches across restart without losing app preferences', async () => {
    const settings = await import('./settings.service')
    settings.setLanguage('sk')
    settings.setTerminalSettings({ fontSize: 18, darkTheme: 'dracula', copyOnSelect: true })
    settings.setTerminalSettings({ scrollback: 50_000, gpuAcceleration: 'off' })
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings()).toMatchObject({ language: 'sk', terminal: {
      fontSize: 18, darkTheme: 'dracula', copyOnSelect: true, scrollback: 50_000, gpuAcceleration: 'off'
    } })
  })

  it('retains the applied terminal preferences when persistence fails', async () => {
    const settings = await import('./settings.service')
    const before = settings.getSettings().terminal
    fs.mkdirSync(path.join(userData, 'settings.json'))
    expect(() => settings.setTerminalSettings({ fontSize: 24 })).toThrow('Failed to persist settings')
    expect(settings.getSettings().terminal).toEqual(before)
  })

  it('persists the global accent and its reset across restarts', async () => {
    const settings = await import('./settings.service')
    expect(settings.getSettings().accentColor).toBeNull()
    settings.setTheme('dark')
    settings.setAttentionColor('#fab387')
    settings.setAccentColor('#38BDF8')
    vi.resetModules()
    const restarted = await import('./settings.service')
    expect(restarted.getSettings()).toMatchObject({
      accentColor: '#38bdf8', theme: 'dark', attentionColor: '#fab387'
    })
    restarted.setAccentColor(null)
    vi.resetModules()
    expect((await import('./settings.service')).getSettings().accentColor).toBeNull()
  })

  it.each([undefined, 'red', '#123', '#gggggg', 123, {}])(
    'uses the theme accent for a missing or invalid stored value: %j',
    async (accentColor) => {
      fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ accentColor }))
      const settings = await import('./settings.service')
      expect(settings.getSettings().accentColor).toBeNull()
    }
  )

  it('retains the accent when persistence fails', async () => {
    const settings = await import('./settings.service')
    expect(settings.getSettings().accentColor).toBeNull()
    fs.mkdirSync(path.join(userData, 'settings.json'))
    expect(() => settings.setAccentColor('#38bdf8')).toThrow('Failed to persist settings')
    expect(settings.getSettings().accentColor).toBeNull()
  })

})
