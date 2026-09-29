import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSettings } from '../services/settings.service'
import { isProcessElevated } from '../services/elevation.service'
import { handle, handleWithEvent } from './handle'

/**
 * Register the global window-control handlers once. Each handler resolves the
 * window from the calling renderer, so it works for any (current/future) window.
 */
export function registerWindowIpc(): void {
  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.WINDOW_MAXIMIZE_TOGGLE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  handle(IPC.APP_IS_ELEVATED, (): Promise<boolean> => isProcessElevated())

  handleWithEvent(IPC.WINDOW_IS_MAXIMIZED, (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // Toggle the macOS blur-behind (vibrancy) for the "transparent" theme.
  // No-op on other platforms.
  ipcMain.on(IPC.WINDOW_SET_VIBRANCY, (event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') return
    if (process.platform !== 'darwin') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setVibrancy(enabled ? 'fullscreen-ui' : null)
    // An opaque window background would paint over the blur.
    win.setBackgroundColor(enabled ? '#00000000' : ['light', 'gradient-light'].includes(getSettings().theme) ? '#edf1f7' : '#0f131a')
  })
}

/** Forward maximize/unmaximize state to a specific window's renderer. */
export function attachWindowMaximizeEvents(win: BrowserWindow): void {
  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, win.isMaximized())
    }
  }
  win.on('maximize', send)
  win.on('unmaximize', send)
}
