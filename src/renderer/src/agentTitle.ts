import type { AgentState } from '@shared/agent-state'

/**
 * Agent CLIs animate a spinner at the start of their terminal title while a
 * turn runs: Claude Code uses ◐◑◒◓ (braille before 2.1.228), Codex braille
 * frames. Claude marks an idle prompt with ✳. Other titles carry no state.
 */
export function agentStateFromTitle(title: string): AgentState | null {
  const first = title.trimStart().codePointAt(0)
  if (first === undefined) return null
  if ((first >= 0x2800 && first <= 0x28ff) || (first >= 0x25d0 && first <= 0x25d3)) return 'working'
  if (first === 0x2733) return 'idle'
  return null
}
