import { sendReview } from '../services/diff-review.service'
import { ipcMain } from 'electron'
import {
  IPC,
  type AgentSession,
  type AgentUsage,
  type StartAgentArgs,
  type StartAgentResult
} from '@shared/types'
import {
  killAgent,
  resizeAgent,
  restoreSessions,
  startAgent,
  updateSessionNickname
} from '../services/agent.service'
import { daemonClient } from '../services/daemonClient'
import { getUsageSnapshots } from '../services/usage.service'
import { consumeUsageReset, getAccountUsage, listUsageProfiles } from '../services/account-usage.service'
import { handle } from './handle'
import { getAgentStates } from '../services/agent-state.service'
import { isStartAgentArgs, validId } from './validation'

export function registerAgentIpc(): void {
  handle(IPC.AGENT_REVIEW, sendReview)
  handle(IPC.USAGE_PROFILES, () => listUsageProfiles())
  handle(IPC.USAGE_RESET, consumeUsageReset)
  handle(IPC.USAGE_ACCOUNTS, (ids: string[], force: boolean) => {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string' || id.length > 256) || typeof force !== 'boolean') {
      return Promise.resolve([])
    }
    return getAccountUsage(ids, force)
  })
  handle(IPC.AGENT_START, (payload: StartAgentArgs): Promise<StartAgentResult> => {
    if (!isStartAgentArgs(payload)) return Promise.resolve({ error: 'Invalid terminal launch request.' })
    return startAgent(payload)
  })

  handle(IPC.AGENT_RESTORE, (): Promise<AgentSession[]> => restoreSessions())

  handle(IPC.AGENT_USAGE_GET, (): AgentUsage[] => getUsageSnapshots())

  handle(IPC.AGENT_STATES_GET, () => getAgentStates())

  handle(IPC.AGENT_KILL, (id: string): Promise<void> => {
    if (!validId(id)) return Promise.reject(new Error('Invalid terminal session id.'))
    return killAgent(id)
  })

  handle(
    IPC.AGENT_UPDATE_META,
    (payload: { id: string; nickname: string }): void => {
      if (!payload || !validId(payload.id) || typeof payload.nickname !== 'string') return
      updateSessionNickname(payload.id, payload.nickname)
    }
  )

  ipcMain.on(IPC.AGENT_ATTACH, (_event, id: string) => {
    if (validId(id)) daemonClient.attach(id)
  })

  ipcMain.on(IPC.AGENT_DETACH, (_event, id: string) => {
    if (validId(id)) daemonClient.detach(id)
  })

  ipcMain.on(IPC.AGENT_INPUT, (_event, payload: { id: string; data: string }) => {
    if (payload && validId(payload.id) && typeof payload.data === 'string' && payload.data.length <= 8_000_000) {
      daemonClient.input(payload.id, payload.data)
    }
  })

  ipcMain.on(IPC.AGENT_RESIZE, (_event, payload: { id: string; cols: number; rows: number }) => {
    if (
      payload &&
      validId(payload.id) &&
      Number.isFinite(payload.cols) &&
      Number.isFinite(payload.rows) &&
      payload.cols >= 1 && payload.cols <= 1000 &&
      payload.rows >= 1 && payload.rows <= 1000
    ) {
      resizeAgent(payload.id, Math.floor(payload.cols), Math.floor(payload.rows))
    }
  })
}
