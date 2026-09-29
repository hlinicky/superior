import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { agentStateFromHook, type AgentState, type AgentStateEvent } from '@shared/agent-state'
import { userDataFile } from '../lib/jsonStore'

/**
 * Receives Claude hook payloads. Each terminal gets its own file name through
 * SUPERIOR_SESSION_ID; the hook atomically replaces `<id>.json` with the latest
 * event, so only the newest state per session matters.
 */

const FILE_RE = /^([0-9a-f-]{36})\.json$/
const STALE_MS = 7 * 24 * 60 * 60_000
const states = new Map<string, AgentState>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()
let watcher: fs.FSWatcher | null = null

export function agentStateDir(): string {
  return userDataFile('agent-state')
}

/** Env handed to a new terminal so its hooks can report into {@link agentStateDir}. */
export function agentStateEnv(id: string): Record<string, string> {
  return { SUPERIOR_AGENT_STATE_DIR: agentStateDir(), SUPERIOR_SESSION_ID: id }
}

function broadcast(event: AgentStateEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.AGENT_STATE, event)
  }
}

function read(id: string): void {
  pending.delete(id)
  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(`${agentStateDir()}/${id}.json`, 'utf-8'))
  } catch {
    return // removed or mid-replace; the next event rewrites it
  }
  const state = agentStateFromHook(payload)
  if (state === undefined || (state ?? undefined) === states.get(id)) return
  if (state) states.set(id, state)
  else states.delete(id)
  broadcast({ id, state })
}

/** Latest known hook state for each session, for a renderer that loads later. */
export function getAgentStates(): AgentStateEvent[] {
  return [...states].map(([id, state]) => ({ id, state }))
}

export function forgetAgentState(id: string): void {
  states.delete(id)
  clearTimeout(pending.get(id))
  pending.delete(id)
  fs.rm(`${agentStateDir()}/${id}.json`, { force: true }, () => {})
}

export function startAgentStateWatcher(): void {
  if (watcher) return
  const dir = agentStateDir()
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const now = Date.now()
    for (const name of fs.readdirSync(dir)) {
      const file = `${dir}/${name}`
      const stat = fs.statSync(file)
      if (name.endsWith('.tmp') || now - stat.mtimeMs > STALE_MS) fs.rmSync(file, { force: true })
    }
    watcher = fs.watch(dir, (_event, name) => {
      const id = name && FILE_RE.exec(String(name))?.[1]
      if (!id || pending.has(id)) return
      // Coalesce the rename burst of one hook write.
      pending.set(id, setTimeout(() => read(id), 25))
    })
    watcher.on('error', () => { watcher?.close(); watcher = null })
  } catch {
    // Without a watcher detection falls back to terminal titles and output.
  }
}
