import { describe, expect, it } from 'vitest'
import { hasElevatedGroup, isProcessElevated } from './elevation.service'

describe('elevation detection', () => {
  it('recognizes high and system integrity labels only', () => {
    expect(hasElevatedGroup('"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""')).toBe(true)
    expect(hasElevatedGroup('"Mandatory Label\\System Mandatory Level","Label","S-1-16-16384",""')).toBe(true)
    expect(hasElevatedGroup('"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""')).toBe(false)
    expect(hasElevatedGroup('')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('never reports elevation outside Windows', async () => {
    await expect(isProcessElevated()).resolves.toBe(false)
  })
})
