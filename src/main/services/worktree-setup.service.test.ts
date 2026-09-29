import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@shared/types'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.root } }))
import { cancelSetup, copySetupFile, ensureSetupReady, getSetupConfig, getSetupState, initializeSetup, runSetup, saveSetupConfig, stopAllSetups } from './worktree-setup.service'

let workspace: Workspace
const command = (script: string): string => process.platform === 'win32'
  ? `"${process.execPath}" -e "${script.replace(/"/g, '\\"')}"`
  : `'${process.execPath.replace(/'/g, `'\\''`)}' -e '${script.replace(/'/g, `'\\''`)}'`

beforeEach(() => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-setup-'))
  const folderPath = path.join(fixture.root, 'project')
  const worktreePath = path.join(fixture.root, 'worktree')
  fs.mkdirSync(folderPath)
  fs.mkdirSync(worktreePath)
  workspace = { id: 'workspace', name: 'Test', folderPath, worktreePath, branch: 'test', createdAt: 1 }
})
afterEach(async () => {
  await stopAllSetups()
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

describe('worktree preparation', () => {
  it('copies local files before sequential commands, in the checkout, and gates agent launch', async () => {
    fs.writeFileSync(path.join(workspace.folderPath, '.env.local'), 'local-only')
    saveSetupConfig(workspace.folderPath, { copyFiles: ['.env.local'], commands: [
      command('const fs=require("fs"); if(fs.readFileSync(".env.local","utf8")!=="local-only")process.exit(5); fs.writeFileSync("first","yes");console.log("installing");'),
      command('const fs=require("fs");if(!fs.existsSync("first"))process.exit(6);fs.writeFileSync("second",process.env.SUPERIOR_WORKTREE_PATH);')
    ] })
    initializeSetup(workspace)
    const run = runSetup(workspace)
    const waiting = ensureSetupReady(workspace)
    expect(getSetupState(workspace)?.status).toBe('running')
    await Promise.all([run, waiting])
    expect(fs.readFileSync(path.join(workspace.worktreePath!, 'second'), 'utf8')).toBe(workspace.worktreePath)
    expect(fs.existsSync(path.join(workspace.folderPath, 'first'))).toBe(false)
    expect(getSetupState(workspace)).toMatchObject({ status: 'ready', output: expect.stringContaining('installing') })
  })

  it('stops on failure, blocks launch, and retries in the same checkout with updated settings', async () => {
    saveSetupConfig(workspace.folderPath, { copyFiles: [], commands: [command('console.error("install failed");process.exit(7)'), command('require("fs").writeFileSync("should-not-run","")')] })
    initializeSetup(workspace)
    await runSetup(workspace)
    expect(getSetupState(workspace)).toMatchObject({ status: 'failed', error: expect.stringContaining('7'), output: expect.stringContaining('install failed') })
    await expect(ensureSetupReady(workspace)).rejects.toThrow('not ready')
    expect(fs.existsSync(path.join(workspace.worktreePath!, 'should-not-run'))).toBe(false)
    fs.writeFileSync(path.join(workspace.worktreePath!, 'keep'), 'work')
    saveSetupConfig(workspace.folderPath, { copyFiles: [], commands: [command('console.log("fixed")')] })
    await runSetup(workspace)
    await expect(ensureSetupReady(workspace)).resolves.toBeUndefined()
    expect(fs.readFileSync(path.join(workspace.worktreePath!, 'keep'), 'utf8')).toBe('work')
    expect(getSetupState(workspace)?.output).toContain('fixed')
  })

  it('coalesces concurrent preparations and cancels the active process before settling', async () => {
    saveSetupConfig(workspace.folderPath, { copyFiles: [], commands: [command('setInterval(()=>console.log("waiting"),20)')] })
    const first = runSetup(workspace)
    expect(runSetup(workspace)).toBe(first)
    await vi.waitFor(() => expect(getSetupState(workspace)?.output).toContain('waiting'))
    await cancelSetup(workspace.id)
    await first
    expect(getSetupState(workspace)).toMatchObject({ status: 'failed', error: 'Setup canceled.' })
    await expect(ensureSetupReady(workspace)).rejects.toThrow('canceled')
  })

  it('handles immediate cancellation, empty settings, and legacy worktrees', async () => {
    await expect(ensureSetupReady(workspace)).resolves.toBeUndefined()
    expect(getSetupState(workspace)).toBeNull()
    const run = runSetup(workspace)
    await cancelSetup(workspace.id)
    await run
    expect(getSetupState(workspace)?.status).toBe('failed')
    await runSetup(workspace)
    expect(getSetupState(workspace)?.status).toBe('ready')
  })

  it('fails closed on invalid configuration, missing files, and interrupted preparation', async () => {
    initializeSetup(workspace)
    expect(getSetupState(workspace)).toMatchObject({ status: 'failed', error: expect.stringContaining('interrupted') })
    saveSetupConfig(workspace.folderPath, { commands: [], copyFiles: ['missing'] })
    await runSetup(workspace)
    expect(getSetupState(workspace)?.status).toBe('failed')
    const config = fs.readdirSync(path.join(fixture.root, 'worktree-setup')).find(f => f.startsWith('project-'))!
    fs.writeFileSync(path.join(fixture.root, 'worktree-setup', config), '{broken')
    await runSetup(workspace)
    expect(getSetupState(workspace)?.status).toBe('failed')
    expect(() => getSetupConfig(workspace.folderPath)).toThrow()
  })

  it('bounds retained output', async () => {
    saveSetupConfig(workspace.folderPath, { commands: [command('console.log("x".repeat(100000));console.log("tail")')], copyFiles: [] })
    await runSetup(workspace)
    expect(getSetupState(workspace)?.output.length).toBeLessThanOrEqual(64_000)
    expect(getSetupState(workspace)?.output).toContain('tail')
  })
})

describe('setup copies', () => {
  it('keeps existing files and preserves copied file permissions', () => {
    fs.writeFileSync(path.join(workspace.folderPath, 'secret'), 'source', { mode: 0o600 })
    copySetupFile(workspace.folderPath, workspace.worktreePath!, 'secret')
    fs.writeFileSync(path.join(workspace.worktreePath!, 'secret'), 'edited')
    copySetupFile(workspace.folderPath, workspace.worktreePath!, 'secret')
    expect(fs.readFileSync(path.join(workspace.worktreePath!, 'secret'), 'utf8')).toBe('edited')
    if (process.platform !== 'win32') expect(fs.statSync(path.join(workspace.worktreePath!, 'secret')).mode & 0o777).toBe(0o600)
  })
  it('rejects traversal, Git metadata, directories, and source/destination symlinks', () => {
    for (const file of ['../secret', '/etc/passwd', '.git/config', '.git /config', '.git./config', 'a/../../b', 'a\\b', 'C:/foo']) {
      expect(() => copySetupFile(workspace.folderPath, workspace.worktreePath!, file)).toThrow()
    }
    fs.mkdirSync(path.join(workspace.folderPath, 'directory'))
    expect(() => copySetupFile(workspace.folderPath, workspace.worktreePath!, 'directory')).toThrow('file')
    if (process.platform === 'win32') return
    fs.symlinkSync(fixture.root, path.join(workspace.folderPath, 'link'))
    expect(() => copySetupFile(workspace.folderPath, workspace.worktreePath!, 'link/file')).toThrow('Symlinks')
    fs.writeFileSync(path.join(workspace.folderPath, 'file'), 'source')
    fs.symlinkSync(path.join(fixture.root, 'outside'), path.join(workspace.worktreePath!, 'file'))
    expect(() => copySetupFile(workspace.folderPath, workspace.worktreePath!, 'file')).toThrow('Symlinks')
    expect(fs.existsSync(path.join(fixture.root, 'outside'))).toBe(false)
  })
})
