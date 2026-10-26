import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSoundOn, play, setSoundOn, SOUND_NAMES } from './sound'

afterEach(() => vi.unstubAllGlobals())

describe('sound', () => {
  it('has every sound the UI uses', () => {
    expect([...SOUND_NAMES].sort()).toEqual(['coin', 'delete', 'error', 'kaching', 'pop', 'save', 'scan', 'stash', 'warn', 'welcome'])
  })

  it('preference persists and defaults to on', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    expect(isSoundOn()).toBe(true)
    setSoundOn(false)
    expect(isSoundOn()).toBe(false)
    setSoundOn(true)
    expect(isSoundOn()).toBe(true)
  })

  it('never throws even without window/AudioContext, and logs plays for the tutorial clip', () => {
    expect(() => play('coin')).not.toThrow()
    const log: { name: string }[] = []
    vi.stubGlobal('window', { __soundLog: log })
    vi.stubGlobal('localStorage', { getItem: () => 'off', setItem: () => {} })
    play('kaching')
    expect(log.map((l) => l.name)).toEqual(['kaching'])
  })
})
