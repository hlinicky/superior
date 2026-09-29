import { useSyncExternalStore } from 'react'
import type { AgentState } from '@shared/agent-state'
import type { AgentSession } from './types'
import { TerminalSignals } from './terminalSignals'
import { agentStateFromTitle } from './agentTitle'

/** Output pulse only: silence says nothing about whether the task is done. */
const IDLE_MS = 400

/**
 * Renderer-side store deriving transient signals from the raw PTY data stream,
 * kept outside React so per-chunk activity never re-renders the app — only the
 * components subscribed here (sidebar, terminal chrome) update, and only when
 * the *derived* sets actually change:
 *
 * - **busy sessions/workspaces**: a session is busy while output keeps arriving
 *   and goes idle IDLE_MS after its last chunk; its workspace is busy while any
 *   of its running sessions are.
 * - **attention sessions**: an explicit terminal alert or process exit flags
 *   the session (unless it is the focused cell of a focused app) until the user
 *   focuses its cell, so they can tell which terminal needs attention.
 * - **attention workspaces**: derived from unread session alerts. Output and
 *   redraws never acknowledge an alert or re-arm native notifications.
 *
 * Replay chunks (scrollback restored on attach) are ignored, so reattaching a
 * session never looks busy or raises attention.
 *
 * When the agent itself reports its turn (Claude hooks, or a spinner in the
 * Claude/Codex terminal title), that state replaces the output heuristic: busy
 * exactly while working, and attention once a turn stops or asks permission.
 * Hooks win over the title.
 */

interface SessionInfo {
  workspaceId: string
  running: boolean
}

let sessionInfo = new Map<string, SessionInfo>()
let activeWs: string | null = null
let activeSession: string | null = null
const busySessions = new Set<string>()
const attention = new Set<string>()
const sessionAttention = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const signals = new Map<string, TerminalSignals>()
// At most one notification per interaction, even if the CLI rings repeatedly.
const reported = new Set<string>()
const pendingReports = new Map<string, object>()
const exitedSessions = new Set<string>()
const hookStates = new Map<string, AgentState>()
const titleStates = new Map<string, AgentState>()
const listeners = new Set<() => void>()
let started = false
// Last meaningful activity per workspace (terminal start/exit, agent turn events), for Recent sort.
const workspaceActivity = new Map<string, number>()
let activityDirty = false
const activityListeners = new Set<(activity: ReadonlyMap<string, number>) => void>()

// Snapshots handed to useSyncExternalStore — replaced only on real change so
// unchanged reads keep the same reference and subscribers skip re-rendering.
let busyWorkspacesSnap = new Set<string>()
let busySessionsSnap = new Set<string>()
let attentionSnap = new Set<string>()
let sessionAttentionSnap = new Set<string>()
let workspaceActivitySnap: ReadonlyMap<string, number> = new Map()
let agentWorkspaceSnap: ReadonlyMap<string, 'waiting' | 'working'> = new Map()
let agentWorkspaceKey = ''

function bumpWorkspace(workspaceId: string, at = Date.now()): void {
  if ((workspaceActivity.get(workspaceId) ?? 0) >= at) return
  workspaceActivity.set(workspaceId, at)
  activityDirty = true
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function refresh(): void {
  attention.clear()
  for (const id of sessionAttention) {
    const wsId = sessionInfo.get(id)?.workspaceId
    if (wsId && wsId !== activeWs) attention.add(wsId)
  }
  const busyWs = new Set<string>()
  for (const id of busySessions) {
    const info = sessionInfo.get(id)
    if (info?.running) busyWs.add(info.workspaceId)
  }
  let changed = false
  if (!setsEqual(busyWs, busyWorkspacesSnap)) {
    busyWorkspacesSnap = busyWs
    changed = true
  }
  if (!setsEqual(busySessions, busySessionsSnap)) {
    busySessionsSnap = new Set(busySessions)
    changed = true
  }
  if (!setsEqual(attention, attentionSnap)) {
    attentionSnap = new Set(attention)
    changed = true
  }
  if (!setsEqual(sessionAttention, sessionAttentionSnap)) {
    sessionAttentionSnap = new Set(sessionAttention)
    changed = true
  }
  const agentWorkspaces = new Map<string, 'waiting' | 'working'>()
  for (const [id, info] of sessionInfo) {
    const state = info.running ? agentState(id) : undefined
    if (state === 'waiting') agentWorkspaces.set(info.workspaceId, 'waiting')
    else if (state === 'working' && !agentWorkspaces.has(info.workspaceId)) agentWorkspaces.set(info.workspaceId, 'working')
  }
  const key = JSON.stringify([...agentWorkspaces])
  if (key !== agentWorkspaceKey) {
    agentWorkspaceKey = key
    agentWorkspaceSnap = agentWorkspaces
    changed = true
  }
  if (activityDirty) {
    activityDirty = false
    workspaceActivitySnap = new Map(workspaceActivity)
    for (const listener of activityListeners) listener(workspaceActivitySnap)
    changed = true
  }
  if (changed) for (const listener of listeners) listener()
}

type Notifier = (sessionId: string, workspaceId: string, isCurrent: () => boolean) => void
let notifier: Notifier | null = null

/** Install the explicit-attention callback (App wires OS notifications here). */
export function setActivityNotifier(fn: Notifier | null): void {
  notifier = fn
}

function stopOutput(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
  busySessions.delete(id)
}

function requestAttention(id: string): void {
  stopOutput(id)
  const wsId = sessionInfo.get(id)?.workspaceId
  if (!wsId) return
  bumpWorkspace(wsId)
  if (!reported.has(id)) {
    reported.add(id)
    if (id !== activeSession || !document.hasFocus()) sessionAttention.add(id)
    if (!document.hasFocus()) {
      const token = {}
      pendingReports.set(id, token)
      notifier?.(id, wsId, () => pendingReports.get(id) === token && sessionInfo.has(id))
    }
  }
  refresh()
}

const agentState = (id: string): AgentState | undefined => hookStates.get(id) ?? titleStates.get(id)

function setAgentState(source: Map<string, AgentState>, id: string, state: AgentState | null): void {
  const before = agentState(id)
  if (state) source.set(id, state)
  else source.delete(id)
  const after = agentState(id)
  if (after === before) return
  if (after === 'working') {
    stopOutput(id)
    busySessions.add(id)
    const wsId = sessionInfo.get(id)?.workspaceId
    if (wsId) bumpWorkspace(wsId)
    refresh()
  } else if (before === 'working' || after === 'waiting') {
    requestAttention(id)
  } else {
    stopOutput(id)
    refresh()
  }
}

function forgetAgentState(id: string): void {
  hookStates.delete(id)
  titleStates.delete(id)
}

/** New user input acknowledges the alert and allows the next interaction to notify. */
export function noteActivityInput(id: string): void {
  reported.delete(id)
  pendingReports.delete(id)
  sessionAttention.delete(id)
  refresh()
}

function start(): void {
  if (started) return
  started = true

  window.addEventListener('focus', () => {
    // Cancel callbacks awaiting settings, including alerts in other cells.
    pendingReports.clear()
    if (activeSession) sessionAttention.delete(activeSession)
    refresh()
  })

  window.api.onAgentData(({ id, data, replay }) => {
    if (replay || !data || !sessionInfo.get(id)?.running || exitedSessions.has(id)) return
    let parser = signals.get(id)
    if (!parser) {
      parser = new TerminalSignals((title) => setAgentState(titleStates, id, agentStateFromTitle(title)))
      signals.set(id, parser)
    }
    const stateBefore = agentState(id)
    if (parser.read(data)) {
      requestAttention(id)
      return
    }
    // Output is not activity while the agent reports its turn, including the chunk that ended it.
    if (stateBefore || agentState(id)) return
    const existing = timers.get(id)
    if (existing !== undefined) clearTimeout(existing)
    busySessions.add(id)
    timers.set(
      id,
      setTimeout(() => {
        stopOutput(id)
        refresh()
      }, IDLE_MS)
    )
    if (!existing) refresh()
  })

  // An actual exit is authoritative even for silent processes. A lost daemon
  // connection is not an exit and must not announce completion.
  window.api.onAgentExit(({ id, exitCode, reason }) => {
    if (!sessionInfo.has(id) || exitedSessions.has(id)) return
    exitedSessions.add(id)
    bumpWorkspace(sessionInfo.get(id)!.workspaceId)
    stopOutput(id)
    signals.delete(id)
    forgetAgentState(id)
    if (reason !== 'interrupted' && exitCode !== null) requestAttention(id)
    else {
      pendingReports.delete(id)
      refresh()
    }
  })

  window.api.onAgentState(({ id, state }) => {
    if (sessionInfo.get(id)?.running && !exitedSessions.has(id)) setAgentState(hookStates, id, state)
  })
  // Sessions restored after a reload resume their last reported state quietly.
  void window.api.getAgentStates().then((states) => {
    for (const { id, state } of states) {
      // The session list may still be loading; unknown ids are dropped with it.
      if (state && !hookStates.has(id)) {
        hookStates.set(id, state)
        if (state === 'working' && sessionInfo.get(id)?.running) busySessions.add(id)
      }
    }
    refresh()
  }).catch(() => {})
}

/** Feed the current session list (id → workspace, running) from App state. */
export function setActivitySessions(sessions: AgentSession[]): void {
  const next = new Map<string, SessionInfo>()
  for (const s of sessions) {
    next.set(s.id, { workspaceId: s.workspaceId, running: s.status === 'running' })
    // A terminal start counts as activity; createdAt keeps restored sessions from looking new.
    if (Number.isFinite(s.createdAt)) bumpWorkspace(s.workspaceId, s.createdAt)
  }
  // Drop attention/timers for sessions that no longer exist (closed cells).
  for (const id of [...sessionAttention]) if (!next.has(id)) sessionAttention.delete(id)
  for (const id of sessionInfo.keys()) {
    if (!next.has(id)) {
      stopOutput(id)
      signals.delete(id)
      reported.delete(id)
      pendingReports.delete(id)
      exitedSessions.delete(id)
      forgetAgentState(id)
    }
  }
  for (const [id, info] of next) {
    if (!info.running) {
      stopOutput(id)
      signals.delete(id)
      forgetAgentState(id)
    }
  }
  sessionInfo = next
  refresh()
}

/** Track the focused workspace; focusing one dismisses its pulse. */
export function setActivityActiveWorkspace(id: string | null): void {
  activeWs = id
  refresh()
}

/**
 * Track the focused session: focusing a cell counts as seeing its attention
 * flag, so the attention dot clears the moment the user lands in the terminal.
 */
export function setActivityActiveSession(id: string | null): void {
  activeSession = id
  if (id && document.hasFocus()) {
    pendingReports.delete(id)
    sessionAttention.delete(id)
    refresh()
  }
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Workspace ids with a running session currently producing output. */
export function useBusyWorkspaces(): Set<string> {
  return useSyncExternalStore(
    subscribe,
    () => busyWorkspacesSnap,
    () => busyWorkspacesSnap
  )
}

/** Session ids currently producing output. */
export function useBusySessions(): Set<string> {
  return useSyncExternalStore(
    subscribe,
    () => busySessionsSnap,
    () => busySessionsSnap
  )
}

/** Workspace ids with unread explicit terminal alerts. */
export function useAttentionWorkspaces(): Set<string> {
  return useSyncExternalStore(
    subscribe,
    () => attentionSnap,
    () => attentionSnap
  )
}

/** Session ids with unread explicit terminal alerts. */
export function useAttentionSessions(): Set<string> {
  return useSyncExternalStore(
    subscribe,
    () => sessionAttentionSnap,
    () => sessionAttentionSnap
  )
}

/** Merge persisted workspace activity (newer in-memory values win). */
export function primeWorkspaceActivity(entries: Record<string, number>): void {
  for (const [id, at] of Object.entries(entries)) bumpWorkspace(id, at)
  refresh()
}

/** Observe activity changes, e.g. to persist them. Returns an unsubscribe function. */
export function onWorkspaceActivity(listener: (activity: ReadonlyMap<string, number>) => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}

/** Last activity timestamp per workspace id. */
export function useWorkspaceActivity(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    subscribe,
    () => workspaceActivitySnap,
    () => workspaceActivitySnap
  )
}

/** Workspaces whose agents report waiting (wins) or working. */
export function useAgentWorkspaceStates(): ReadonlyMap<string, 'waiting' | 'working'> {
  return useSyncExternalStore(
    subscribe,
    () => agentWorkspaceSnap,
    () => agentWorkspaceSnap
  )
}
