import { execFile } from 'child_process'
import * as path from 'path'

/** Mandatory-label SIDs for high and system integrity, i.e. an elevated token. */
const ELEVATED_LEVELS = ['S-1-16-12288', 'S-1-16-16384']

export function hasElevatedGroup(whoamiGroups: string): boolean {
  return ELEVATED_LEVELS.some((sid) => whoamiGroups.includes(sid))
}

let cached: Promise<boolean> | undefined

/**
 * Agent CLIs inherit this process token. Codex refuses to start its Windows
 * daemon when elevated, so the renderer warns instead of letting it fail later.
 * Detection failures report "not elevated" so they never block the app.
 */
export function isProcessElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  cached ??= new Promise((resolve) => {
    const whoami = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')
    execFile(whoami, ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      resolve(!err && hasElevatedGroup(stdout)))
  })
  return cached
}
