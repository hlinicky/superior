import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { agentStateFromHook } from '@shared/agent-state'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), isReady: () => false } }))
import { CLAUDE_STATE_HOOK, withStateHooks, withoutStateHooks } from './claude-hooks.service'

const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }

describe('Claude state hooks', () => {
  it('adds one hook per event, keeps user hooks, and is idempotent', () => {
    const once = withStateHooks({ model: 'opus', hooks: { PreToolUse: [userHook] } })!
    const twice = withStateHooks(once)!
    expect(twice).toEqual(once)
    const hooks = once.hooks as Record<string, unknown[]>
    expect(once.model).toBe('opus')
    expect(hooks.PreToolUse).toEqual([userHook, { matcher: '*', hooks: [{ type: 'command', command: CLAUDE_STATE_HOOK, timeout: 5 }] }])
    expect(Object.keys(hooks).sort()).toEqual(['PermissionRequest', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit'])
  })

  it('removes only its own hooks', () => {
    expect(withoutStateHooks(withStateHooks({ hooks: { PreToolUse: [userHook] } })!)).toEqual({ hooks: { PreToolUse: [userHook] } })
    expect(withoutStateHooks(withStateHooks({ theme: 'dark' })!)).toEqual({ theme: 'dark' })
  })

  it('leaves unexpected hook shapes untouched', () => {
    expect(withStateHooks({ hooks: [] })).toBeNull()
    expect(withStateHooks({ hooks: { Stop: 'bad' } })).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('writes the payload inside Superior and is inert outside it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-hook-'))
    const payload = JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'x' })
    const id = '6f1c2d3e-0000-4000-8000-000000000000'
    const run = (env: Record<string, string>): void => {
      execFileSync('/bin/sh', ['-c', CLAUDE_STATE_HOOK], { input: payload, env: { PATH: process.env.PATH ?? '', ...env } })
    }
    run({})
    expect(fs.readdirSync(dir)).toEqual([])
    run({ SUPERIOR_AGENT_STATE_DIR: dir, SUPERIOR_SESSION_ID: id })
    expect(fs.readdirSync(dir)).toEqual([`${id}.json`])
    expect(agentStateFromHook(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8')))).toBe('waiting')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('hook event mapping', () => {
  it('maps turn events and ignores the rest', () => {
    expect(agentStateFromHook({ hook_event_name: 'UserPromptSubmit' })).toBe('working')
    expect(agentStateFromHook({ hook_event_name: 'Stop' })).toBe('idle')
    expect(agentStateFromHook({ hook_event_name: 'SessionEnd' })).toBeNull()
    expect(agentStateFromHook({ hook_event_name: 'Notification' })).toBeUndefined()
    expect(agentStateFromHook({ hook_event_name: 'toString' })).toBeUndefined()
    expect(agentStateFromHook(null)).toBeUndefined()
  })
})
