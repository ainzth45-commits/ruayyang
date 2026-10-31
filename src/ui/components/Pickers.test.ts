// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateField, MonthField } from './Pickers'

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON() {} })

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('mobile date and month panels', () => {
  for (const mode of ['date', 'month'] as const) {
    it(`reveals the ${mode} panel within the form, including after keyboard dismissal`, () => {
      vi.useFakeTimers()
      const vv = new EventTarget()
      vi.stubGlobal('visualViewport', vv)
      const globalReveal = vi.fn()
      HTMLElement.prototype.scrollIntoView = globalReveal
      const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      render(createElement('div', { className: 'sheet-body' }, mode === 'date'
        ? createElement(DateField, { label: 'วันที่', value: '2026-10-31', onChange: vi.fn() })
        : createElement(MonthField, { label: 'เดือน', value: '2026-10', onChange: vi.fn() })))
      const body = document.querySelector('.sheet-body') as HTMLElement
      vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => rect(100, 350))
      const scroll = vi.fn()
      Object.defineProperty(body, 'scrollTo', { value: scroll })
      fireEvent.click(screen.getByRole('button', { name: mode === 'date' ? /^วันที่/ : /^เดือน/ }))
      const panel = screen.getByRole('dialog', { name: mode === 'date' ? 'เลือกวันที่' : 'เลือกเดือน' })
      vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => rect(500, 900))
      act(() => vi.advanceTimersByTime(100))
      // A panel taller than the available height starts with its header visible; the rest remains scrollable.
      expect(scroll).toHaveBeenLastCalledWith({ top: 384, behavior: 'auto' })
      const count = scroll.mock.calls.length
      act(() => { vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(100) })
      expect(scroll.mock.calls.length).toBeGreaterThan(count)
      expect(globalReveal).not.toHaveBeenCalled()
      expect(pageScroll).not.toHaveBeenCalled()
    })
  }
})
