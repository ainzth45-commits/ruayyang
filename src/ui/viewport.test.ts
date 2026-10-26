import { describe, expect, it } from 'vitest'
import { computeViewport } from './viewport'

describe('computeViewport', () => {
  it('keyboard closed', () => expect(computeViewport(932, 932, 0)).toEqual({ vvh: 932, vvt: 0, kb: 0, open: false }))
  it('keyboard open on iPhone 14 Pro Max (~336px)', () => expect(computeViewport(932, 596, 0)).toEqual({ vvh: 596, vvt: 0, kb: 336, open: true }))
  it('iOS scrolled the page while keyboard open', () => expect(computeViewport(932, 596, 120)).toEqual({ vvh: 596, vvt: 120, kb: 216, open: true }))
  it('small change (URL bar) is not a keyboard', () => expect(computeViewport(932, 880, 0).open).toBe(false))
  it('rounds fractional values and never negative', () => expect(computeViewport(932, 596.4, -3.2)).toEqual({ vvh: 596, vvt: 0, kb: 339, open: true }))
})
