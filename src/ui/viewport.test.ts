// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { computeViewport, installViewport } from './viewport'

describe('computeViewport', () => {
  it('keyboard closed', () => expect(computeViewport(932, 932, 0)).toEqual({ vvh: 932, vvt: 0, kb: 0, open: false }))
  it('keyboard open on iPhone 14 Pro Max (~336px)', () => expect(computeViewport(932, 596, 0)).toEqual({ vvh: 596, vvt: 0, kb: 336, open: true }))
  it('iOS scrolled the page while keyboard open', () => expect(computeViewport(932, 596, 120)).toEqual({ vvh: 596, vvt: 120, kb: 216, open: true }))
  it('small change (URL bar) is not a keyboard', () => expect(computeViewport(932, 880, 0).open).toBe(false))
  it('rounds fractional values and never negative', () => expect(computeViewport(932, 596.4, -3.2)).toEqual({ vvh: 596, vvt: 0, kb: 339, open: true }))
})

describe('iPhone visual viewport lifecycle', () => {
  it('keeps the full-height baseline through blur while keyboard is animating, then restores', () => {
    vi.useFakeTimers()
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
    let layout = 844
    vi.stubGlobal('visualViewport', vv)
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => layout)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => layout)
    installViewport()
    const root = document.documentElement
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    layout = 500
    vv.height = 500
    vv.offsetTop = 80
    vv.dispatchEvent(new Event('resize'))
    expect(root.style.getPropertyValue('--vvh')).toBe('500px')
    expect(root.style.getPropertyValue('--vvt')).toBe('80px')
    expect(root.classList.contains('kb-open')).toBe(true)
    field.blur()
    vi.advanceTimersByTime(60)
    // Safari blurs before its visual viewport expands: do not mistake the small height for a new baseline.
    expect(root.classList.contains('kb-open')).toBe(true)
    layout = 844
    vv.height = 844
    vv.offsetTop = 0
    vv.dispatchEvent(new Event('resize'))
    expect(root.style.getPropertyValue('--vvh')).toBe('844px')
    expect(root.style.getPropertyValue('--kb')).toBe('0px')
    expect(root.classList.contains('kb-open')).toBe(false)
    field.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
