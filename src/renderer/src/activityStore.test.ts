import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDataEvent, AgentExitEvent, AgentSession } from './types'
import type { AgentStateEvent } from '@shared/agent-state'

// Exercise the actual singleton store and subscriptions without mounting React.
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, snapshot: () => unknown) => {
    subscribe(() => {})
    return snapshot()
  }
}))

let store: typeof import('./activityStore')
let onData: (event: AgentDataEvent) => void
let onExit: (event: AgentExitEvent) => void
let onState: (event: AgentStateEvent) => void
let onFocus: () => void
let focused: boolean
const notifier = vi.fn()
const sessions = [
  { id: 'a', workspaceId: 'w', status: 'running' },
  { id: 'b', workspaceId: 'w', status: 'running' }
] as AgentSession[]

function output(data: string, id = 'a', replay = false): void {
  onData({ id, data, replay })
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  notifier.mockClear()
  focused = false
  vi.stubGlobal('document', { hasFocus: () => focused })
  vi.stubGlobal('window', {
    addEventListener: (_event: string, fn: () => void) => { onFocus = fn },
    api: {
      onAgentData: (fn: typeof onData) => { onData = fn },
      onAgentExit: (fn: typeof onExit) => { onExit = fn },
      onAgentState: (fn: typeof onState) => { onState = fn },
      getAgentStates: () => Promise.resolve([])
    }
  })
  store = await import('./activityStore')
  store.setActivitySessions(sessions)
  store.setActivityNotifier(notifier)
  store.useBusySessions()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('terminal activity is not task completion', () => {
  it('never announces completion for periodic Windows redraws, startup prompts or long pauses', () => {
    for (const data of ['PS C:\\project> ', '\x1b[2K\r', '\x1b]9;4;1;50\x07']) {
      output(data)
      expect(store.useBusySessions().has('a')).toBe(true)
      vi.advanceTimersByTime(60_000)
      expect(store.useBusySessions().size).toBe(0)
    }
    expect(notifier).not.toHaveBeenCalled()
    expect(store.useAttentionSessions().size).toBe(0)
    expect(store.useAttentionWorkspaces().size).toBe(0)
  })

  it('does not replay old notifications, even when the replay ends in a partial OSC', () => {
    output('\x07\x1b]9;old\x07\x1b]9;', 'a', true)
    output('ordinary output\x1b]0;title\x07')
    vi.runAllTimers()
    expect(notifier).not.toHaveBeenCalled()
  })

  it('coalesces repeated alerts and redraws until another user interaction', () => {
    output('\x1b]9;Needs attention\x07')
    output('redraw')
    vi.advanceTimersByTime(10_000)
    output('\x07\x07')
    expect(notifier).toHaveBeenCalledTimes(1)
    expect(store.useAttentionSessions().has('a')).toBe(true)
    store.noteActivityInput('a')
    expect(store.useAttentionSessions().has('a')).toBe(false)
    output('\x07')
    expect(notifier).toHaveBeenCalledTimes(2)
  })

  it('delivers explicit alerts only after their complete sequence arrives', () => {
    output('\x1b]777;notify;Claude;')
    vi.advanceTimersByTime(20_000)
    expect(notifier).not.toHaveBeenCalled()
    output('Permission needed\x1b')
    expect(notifier).not.toHaveBeenCalled()
    output('\\')
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('notifies exactly once for a silent process exit, even if its session state updated first', () => {
    store.setActivitySessions([{ ...sessions[0], status: 'exited' }])
    onExit({ id: 'a', exitCode: 0 })
    onExit({ id: 'a', exitCode: 0 })
    output('late buffered output')
    vi.runAllTimers()
    expect(notifier).toHaveBeenCalledTimes(1)
    expect(store.useBusySessions().size).toBe(0)
  })

  it('does not announce a daemon disconnect as completion', () => {
    output('working')
    onExit({ id: 'a', exitCode: null, reason: 'interrupted' })
    vi.runAllTimers()
    expect(notifier).not.toHaveBeenCalled()
    expect(store.useBusySessions().size).toBe(0)
  })

  it('does not duplicate an explicit alert when the process then exits', () => {
    output('\x07')
    onExit({ id: 'a', exitCode: 1 })
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('cleans up busy timers, alerts and parser state when a terminal closes', () => {
    output('working')
    output('\x07', 'b')
    const isCurrent = notifier.mock.calls[0][2] as () => boolean
    store.setActivitySessions([])
    expect(isCurrent()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    output('\x07')
    vi.runAllTimers()
    expect(store.useAttentionSessions().size).toBe(0)
    expect(store.useAttentionWorkspaces().size).toBe(0)
    expect(store.useBusySessions().size).toBe(0)
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('does not erase another terminal alert when a sibling starts producing output', () => {
    output('\x07')
    output('working', 'b')
    expect(store.useAttentionWorkspaces().has('w')).toBe(true)
    store.noteActivityInput('b')
    expect(store.useAttentionWorkspaces().has('w')).toBe(true)
  })

  it('invalidates pending delivery on new input', () => {
    output('\x07')
    const isCurrent = notifier.mock.calls[0][2] as () => boolean
    expect(isCurrent()).toBe(true)
    store.noteActivityInput('a')
    expect(isCurrent()).toBe(false)
    output('\x07')
    expect(isCurrent()).toBe(false)
  })

  it('acknowledges the visible cell on window focus and cancels pending notifications', () => {
    store.setActivityActiveSession('a')
    output('\x07')
    output('\x07', 'b')
    const checks = notifier.mock.calls.map((call) => call[2] as () => boolean)
    focused = true
    onFocus()
    expect(checks.every((check) => !check())).toBe(true)
    expect([...store.useAttentionSessions()]).toEqual(['b'])
    focused = false
    output('\x07')
    expect(notifier).toHaveBeenCalledTimes(2)
  })

  it('does not notify while focused but flags an unwatched cell', () => {
    focused = true
    store.setActivityActiveSession('a')
    output('\x07')
    output('\x07', 'b')
    expect(notifier).not.toHaveBeenCalled()
    expect([...store.useAttentionSessions()]).toEqual(['b'])
    store.setActivityActiveSession('b')
    expect(store.useAttentionSessions().size).toBe(0)
  })
})

describe('agent-reported turn state', () => {
  it('stays busy through silent tool calls and alerts once when a titled turn ends', () => {
    output('\x1b]0;◐ Fix the bug\x07')
    vi.advanceTimersByTime(60_000)
    expect(store.useBusySessions().has('a')).toBe(true)
    output('\x1b]0;◓ Fix the bug\x07')
    output('\x1b]0;✳ Fix the bug\x07')
    expect(store.useBusySessions().has('a')).toBe(false)
    expect(store.useAttentionSessions().has('a')).toBe(true)
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('treats a Codex spinner disappearing as the end of the turn', () => {
    output('\x1b]0;⠦ | superior\x07')
    output('\x1b]0;superior\x07')
    expect(store.useBusySessions().has('a')).toBe(false)
    expect(notifier).toHaveBeenCalledTimes(1)
    // A plain title afterwards is not a new turn; output falls back to the pulse.
    output('prompt redraw')
    expect(store.useBusySessions().has('a')).toBe(true)
  })

  it('does not alert for an agent that starts idle', () => {
    output('\x1b]0;✳ Claude Code\x07')
    expect(store.useAttentionSessions().size).toBe(0)
    output('banner text')
    expect(store.useBusySessions().has('a')).toBe(false)
  })

  it('prefers hooks over the title and flags permission requests', () => {
    onState({ id: 'a', state: 'working' })
    output('\x1b]0;✳ stale title\x07')
    expect(store.useBusySessions().has('a')).toBe(true)
    onState({ id: 'a', state: 'waiting' })
    expect(store.useBusySessions().has('a')).toBe(false)
    expect(store.useAttentionSessions().has('a')).toBe(true)
    expect(notifier).toHaveBeenCalledTimes(1)
  })

  it('ignores hook states for unknown or exited sessions', () => {
    onState({ id: 'ghost', state: 'working' })
    onExit({ id: 'b', exitCode: 0 })
    onState({ id: 'b', state: 'working' })
    expect(store.useBusySessions().size).toBe(0)
  })

  it('records workspace activity from terminal starts, finished turns and exits', () => {
    const t0 = Date.now()
    store.setActivitySessions([{ id: 'c', workspaceId: 'x', status: 'running', createdAt: 5 }] as AgentSession[])
    expect(store.useWorkspaceActivity().get('x')).toBe(5)
    store.setActivitySessions(sessions)
    output('\x1b]0;◐ task\x07')
    output('\x1b]0;✳ task\x07')
    expect(store.useWorkspaceActivity().get('w')).toBeGreaterThanOrEqual(t0)
    store.primeWorkspaceActivity({ w: 1, old: 7 })
    expect(store.useWorkspaceActivity().get('w')).toBeGreaterThanOrEqual(t0)
    expect(store.useWorkspaceActivity().get('old')).toBe(7)
  })

  it('reports waiting over working per workspace', () => {
    onState({ id: 'a', state: 'working' })
    expect(store.useAgentWorkspaceStates().get('w')).toBe('working')
    onState({ id: 'b', state: 'waiting' })
    expect(store.useAgentWorkspaceStates().get('w')).toBe('waiting')
  })
})
