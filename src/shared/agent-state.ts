/** What an agent CLI reports about its own turn, from hooks or its terminal title. */
export type AgentState = 'working' | 'waiting' | 'idle'

export interface AgentStateEvent {
  id: string
  /** null: the agent ended; fall back to output-based activity. */
  state: AgentState | null
}

const HOOK_STATES: Record<string, AgentState | null> = {
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  // Also covers AskUserQuestion: either way the agent is blocked on the user.
  PermissionRequest: 'waiting',
  Stop: 'idle',
  SessionEnd: null
}

/** Map a Claude hook payload to a state; undefined means "not a state change". */
export function agentStateFromHook(payload: unknown): AgentState | null | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const name = (payload as { hook_event_name?: unknown }).hook_event_name
  return typeof name === 'string' && Object.hasOwn(HOOK_STATES, name) ? HOOK_STATES[name] : undefined
}
