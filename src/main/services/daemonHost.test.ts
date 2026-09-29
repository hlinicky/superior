import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/superior-test'),
    getAppPath: vi.fn(() => '/tmp/superior-test/app'),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false
  }
}))

import { isInsideDir, isRuntimeNodePtyPath } from './daemonHost'

describe('isInsideDir', () => {
  const install = 'C:\\Users\\me\\AppData\\Local\\Programs\\Superior'

  it('matches the installed exe case-insensitively', () => {
    expect(isInsideDir('c:\\users\\ME\\appdata\\local\\programs\\superior\\Superior.exe', install)).toBe(true)
  })

  it('does not match the relocated host or a sibling with a shared prefix', () => {
    expect(isInsideDir('C:\\Users\\me\\AppData\\Local\\Superior\\daemon-host\\1.0.0\\Superior.exe', install)).toBe(false)
    expect(isInsideDir('C:\\Users\\me\\AppData\\Local\\Programs\\Superior-old\\Superior.exe', install)).toBe(false)
  })

  it('does not treat the directory itself as inside', () => {
    expect(isInsideDir(install, install)).toBe(false)
  })
})

describe('isRuntimeNodePtyPath', () => {
  it.each([
    '',
    'package.json',
    'lib\\index.js',
    'lib\\conpty_console_list_agent.js',
    'build\\Release\\pty.node',
    'build\\Release\\conpty\\conpty.dll',
    'build\\Release\\conpty\\OpenConsole.exe',
    'prebuilds\\win32-x64\\pty.node',
    'third_party\\conpty\\1.23.251008001\\win10-x64\\conpty.dll'
  ])('keeps runtime file %s', (path) => {
    expect(isRuntimeNodePtyPath(path, 'x64')).toBe(true)
  })

  it.each([
    'src\\win\\conpty.cc',
    'deps\\winpty\\src\\winpty.gyp',
    'node-addon-api\\napi.h',
    'build\\Release\\pty.pdb',
    'build\\Release\\obj\\pty\\pty.obj',
    'prebuilds\\win32-arm64\\pty.node',
    'third_party\\conpty\\1.23.251008001\\win10-arm64\\conpty.dll'
  ])('drops non-runtime file %s', (path) => {
    expect(isRuntimeNodePtyPath(path, 'x64')).toBe(false)
  })
})
