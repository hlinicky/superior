import { describe, expect, it } from 'vitest'
import { agentStateFromTitle } from './agentTitle'
import { TerminalSignals } from './terminalSignals'

describe('agent title state', () => {
  it('reads the spinner and idle markers captured from Claude Code and Codex', () => {
    expect(agentStateFromTitle('◐ Reply with just the word ok')).toBe('working')
    expect(agentStateFromTitle('◓ Claude Code')).toBe('working')
    expect(agentStateFromTitle('⠦ | superior')).toBe('working')
    expect(agentStateFromTitle('✳ Claude Code')).toBe('idle')
  })

  it('carries no state for ordinary titles', () => {
    expect(agentStateFromTitle('superior')).toBeNull()
    expect(agentStateFromTitle('~/Development/⠦')).toBeNull()
    expect(agentStateFromTitle('')).toBeNull()
  })

  it('reports OSC 0/2 titles across chunks without raising attention', () => {
    const titles: string[] = []
    const signals = new TerminalSignals((title) => titles.push(title))
    expect(signals.read('\x1b]0;◐ Clau')).toBe(false)
    expect(signals.read('de Code\x07\x1b]2;✳ Claude Code\x1b\\')).toBe(false)
    expect(signals.read('\x1b]1;icon\x07')).toBe(false)
    expect(titles).toEqual(['◐ Claude Code', '✳ Claude Code'])
  })
})
