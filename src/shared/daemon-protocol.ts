import { createHash } from 'crypto'

import type { AgentLaunchTarget, AgentStatus, PresetIconType } from './types'

/** Metadata the app needs to rebuild a session's UI after a restart. */
export interface DaemonSessionMeta {
  label: string
  /** user-set nickname shown after the label; absent until the user names it */
  nickname?: string
  iconType?: PresetIconType
  icon?: string
  color?: string
  command: string
  /** Working directory the session launched in; used to locate its Claude transcript. */
  cwd: string
  /** Where the user command logically runs. Absent means a local cwd from older builds. */
  launchTarget?: AgentLaunchTarget
  workspaceId: string
  /** The tab (a grid within the workspace) this session belongs to. Absent on sessions spawned by an older build. */
  tabId?: string
  createdAt: number
}

/** A session as reported by the daemon's `list`. */
export interface DaemonSession {
  id: string
  meta: DaemonSessionMeta
  pid?: number
  cols: number
  rows: number
  status: AgentStatus
  exitCode?: number
}

export interface DirectSpawn {
  executable: string
  args: string[]
}

/** Who the daemon is: lets the app tell a relocated host from one that locks the install dir. */
export interface DaemonInfo {
  pid: number
  /** The executable the daemon runs from (a relocated copy or the installed app). */
  execPath: string
  /** App version that spawned the daemon; absent when the spawner passed none. */
  version?: string
}

/** Messages a client (the Electron main process) sends to the daemon. */
export type ClientMessage =
  | { t: 'hello' }
  | { t: 'list' }
  | { t: 'shutdown' }
  | {
      t: 'spawn'
      id: string
      command: string
      direct?: DirectSpawn
      cwd: string
      cols: number
      rows: number
      meta: DaemonSessionMeta
      /** Extra SUPERIOR_* variables for the terminal. Older daemons ignore it. */
      env?: Record<string, string>
    }
  | { t: 'attach'; id: string }
  | { t: 'detach'; id: string }
  | { t: 'update'; id: string; meta: Partial<DaemonSessionMeta> }
  | { t: 'input'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string; requestId?: string }

/** Messages the daemon sends back to a client. */
export type ServerMessage =
  | { t: 'data'; id: string; data: string; replay?: boolean }
  | { t: 'exit'; id: string; exitCode: number; signal?: number }
  | { t: 'sessions'; list: DaemonSession[] }
  | { t: 'spawned'; id: string; pid?: number }
  | { t: 'killed'; id: string; requestId: string }
  | { t: 'error'; message: string; id?: string }
  /** Reply to `hello`. Daemons from older builds never send it. */
  | ({ t: 'info' } & DaemonInfo)

/** Default socket / pipe path for the daemon. */
export function daemonSocketPath(userData: string): string {
  if (process.platform === 'win32') {
    // Named pipes are namespaced, not files; derive a stable name from userData.
    // Hash the whole path — a prefix of its raw bytes would be `C:\Users` for
    // everyone, colliding across users and installs.
    const hash = createHash('sha256').update(userData).digest('hex').slice(0, 16)
    return `\\\\.\\pipe\\superior-daemon-${hash}`
  }
  return `${userData}/daemon.sock`
}

// A frame payload is either JSON (control messages — always starts with '{')
// or a binary `data` frame marked by this first byte. Terminal output is full
// of control bytes that JSON would escape 6× larger and re-scan char by char,
// so the hot path skips JSON entirely.
const DATA_FRAME_KIND = 0x01
const FLAG_REPLAY = 0x01
/** Reject malformed local-socket frames before their declared length can exhaust memory. */
export const MAX_DAEMON_FRAME_BYTES = 8 * 1024 * 1024

/** Encode a message as a length-prefixed (4-byte BE) JSON frame. */
export function encodeFrame(msg: ClientMessage | ServerMessage): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  const head = Buffer.allocUnsafe(4)
  head.writeUInt32BE(json.length, 0)
  return Buffer.concat([head, json])
}

/**
 * Encode a `data` server message as a binary frame:
 * [kind:1][flags:1][idLen:1][id][raw utf8 bytes]. Falls back to JSON for an
 * id that doesn't fit the 1-byte length (never the case for our session ids).
 */
export function encodeDataFrame(id: string, data: string, replay = false): Buffer {
  const idBuf = Buffer.from(id, 'utf8')
  if (idBuf.length > 255) {
    return encodeFrame(replay ? { t: 'data', id, data, replay } : { t: 'data', id, data })
  }
  const dataBytes = Buffer.byteLength(data)
  const payloadLen = 3 + idBuf.length + dataBytes
  const buf = Buffer.allocUnsafe(4 + payloadLen)
  buf.writeUInt32BE(payloadLen, 0)
  buf[4] = DATA_FRAME_KIND
  buf[5] = replay ? FLAG_REPLAY : 0
  buf[6] = idBuf.length
  idBuf.copy(buf, 7)
  buf.write(data, 7 + idBuf.length, 'utf8')
  return buf
}

/** Accumulates socket chunks and yields complete decoded frames. */
export class FrameDecoder<T extends ClientMessage | ServerMessage> {
  // Chunks are only merged once a whole frame (or the split 4-byte header) is
  // buffered, so a large frame arriving in many segments copies each byte a
  // bounded number of times instead of re-concatenating the backlog per segment.
  private chunks: Buffer[] = []
  private size = 0

  private compact(): void {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)]
  }

  private decode(payload: Buffer): T | null {
    if (payload.length >= 3 && payload[0] === DATA_FRAME_KIND) {
      const flags = payload[1]
      const idLen = payload[2]
      const id = payload.subarray(3, 3 + idLen).toString('utf8')
      const data = payload.subarray(3 + idLen).toString('utf8')
      const msg: ServerMessage =
        flags & FLAG_REPLAY ? { t: 'data', id, data, replay: true } : { t: 'data', id, data }
      return msg as T
    }
    try {
      return JSON.parse(payload.toString('utf8')) as T
    } catch {
      return null /* skip malformed frame */
    }
  }

  push(chunk: Buffer): T[] {
    this.chunks.push(chunk)
    this.size += chunk.length
    const out: T[] = []
    while (this.size >= 4) {
      if (this.chunks[0].length < 4) this.compact()
      const len = this.chunks[0].readUInt32BE(0)
      if (len > MAX_DAEMON_FRAME_BYTES) {
        this.chunks = []
        this.size = 0
        throw new Error(`Daemon frame exceeds ${MAX_DAEMON_FRAME_BYTES} bytes.`)
      }
      if (this.size < 4 + len) break
      if (this.chunks[0].length < 4 + len) this.compact()
      const first = this.chunks[0]
      const payload = first.subarray(4, 4 + len)
      if (first.length === 4 + len) this.chunks.shift()
      else this.chunks[0] = first.subarray(4 + len)
      this.size -= 4 + len
      const msg = this.decode(payload)
      if (msg) out.push(msg)
    }
    return out
  }
}
