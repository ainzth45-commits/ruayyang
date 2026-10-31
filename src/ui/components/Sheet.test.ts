// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Sheet } from './Sheet'

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON() {} })

describe('mobile sheet keyboard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps amount, date and note focus scrolling inside the sheet after keyboard resize', () => {
    const vv = new EventTarget()
    vi.stubGlobal('visualViewport', vv)
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const globalScroll = vi.fn()
    HTMLElement.prototype.scrollIntoView = globalScroll
    render(createElement(Sheet, { title: 'รายจ่าย', onClose: vi.fn(), children: createElement('form', null,
      ...['ยอด', 'วันที่', 'โน้ต'].map((label) => createElement('input', { key: label, 'aria-label': label })),
      createElement('button', { type: 'submit' }, 'บันทึก')) }))
    const body = document.querySelector('.sheet-body') as HTMLElement
    expect(body).not.toBeNull()
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => rect(100, 360))
    const scroll = vi.fn((opts: ScrollToOptions) => { body.scrollTop = opts.top ?? body.scrollTop })
    Object.defineProperty(body, 'scrollTo', { value: scroll, configurable: true })
    for (const label of ['ยอด', 'วันที่', 'โน้ต']) {
      const field = screen.getByRole('textbox', { name: label })
      vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => rect(380, 424))
      fireEvent.focusIn(field)
      act(() => vi.advanceTimersByTime(300))
      expect(scroll).toHaveBeenCalled()
    }
    const previous = scroll.mock.calls.length
    act(() => { vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(300) })
    expect(scroll.mock.calls.length).toBeGreaterThan(previous)
    expect(globalScroll).not.toHaveBeenCalled()
    expect(pageScroll).not.toHaveBeenCalled()
  })

  it('save stays in normal scroll flow and the modal is anchored to the visible viewport', () => {
    const css = readFileSync('src/ui/styles/app.css', 'utf8')
    expect(css).toMatch(/\.sheet-viewport\s*\{[^}]*height:\s*var\(--vvh/)
    expect(css).toMatch(/\.sheet-body\s*\{[^}]*overflow-y:\s*auto/)
    expect(css).not.toMatch(/\.sheet \.btn\.primary[^}]*position:\s*sticky/)
    expect(css).toMatch(/input, textarea, select\s*\{\s*font-size:\s*16px/)
  })

  it('dismissal blurs the active field so the keyboard can close', () => {
    const onClose = vi.fn()
    render(createElement(Sheet, { title: 'ทดสอบ', onClose, children: createElement('input', { 'aria-label': 'ยอด' }) }))
    const field = screen.getByRole('textbox', { name: 'ยอด' })
    field.focus()
    expect(document.activeElement).toBe(field)
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(document.activeElement).not.toBe(field)
    act(() => vi.advanceTimersByTime(200))
    expect(onClose).toHaveBeenCalledOnce()
  })
})


function touch(target: HTMLElement, type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] })
  fireEvent(target, event)
  return event
}

function verticalSheet(contentHeight = 900) {
  render(createElement(Sheet, { title: 'เพิ่มรายจ่ายรายวัน', verticalOnly: true, onClose: vi.fn(), children: createElement('input', { 'aria-label': 'ยอด' }) }))
  const body = document.querySelector('.sheet-body') as HTMLElement
  Object.defineProperties(body, {
    clientHeight: { value: 300, configurable: true },
    scrollHeight: { value: contentHeight, configurable: true },
  })
  return body
}

describe('add expense sheet contains touch scrolling', () => {
  afterEach(cleanup)
  it('rejects sideways drags without scrolling the page', () => {
    const body = verticalSheet()
    body.scrollTop = 150
    touch(body, 'touchstart', 100, 100)
    expect(touch(body, 'touchmove', 160, 104).defaultPrevented).toBe(true)
  })
  it('allows vertical movement through existing content, then blocks overshooting either boundary', () => {
    const body = verticalSheet()
    body.scrollTop = 150
    touch(body, 'touchstart', 100, 100)
    expect(touch(body, 'touchmove', 101, 60).defaultPrevented).toBe(false)
    body.scrollTop = 600
    expect(touch(body, 'touchmove', 101, 40).defaultPrevented).toBe(true)
    // Reversing direction at the bottom must remain possible.
    expect(touch(body, 'touchmove', 101, 70).defaultPrevented).toBe(false)
    body.scrollTop = 0
    touch(body, 'touchstart', 100, 100)
    expect(touch(body, 'touchmove', 100, 140).defaultPrevented).toBe(true)
  })
  it('does not drag short forms into blank space', () => {
    const body = verticalSheet(200)
    touch(body, 'touchstart', 100, 100)
    expect(touch(body, 'touchmove', 100, 70).defaultPrevented).toBe(true)
    expect(touch(body, 'touchmove', 100, 120).defaultPrevented).toBe(true)
  })
  it('keeps nested textarea scrolling available without leaking past its boundary', () => {
    const body = verticalSheet(200)
    const text = document.createElement('textarea')
    text.style.overflowY = 'auto'
    body.append(text)
    Object.defineProperties(text, { clientHeight: { value: 80 }, scrollHeight: { value: 200 } })
    text.scrollTop = 40
    touch(text, 'touchstart', 100, 100)
    expect(touch(text, 'touchmove', 100, 70).defaultPrevented).toBe(false)
    text.scrollTop = 120
    expect(touch(text, 'touchmove', 100, 50).defaultPrevented).toBe(true)
  })
  it('wraps repeat chips and shrinks grids within the sheet instead of adding a sideways scroller', () => {
    const css = readFileSync('src/ui/styles/app.css', 'utf8')
    expect(css).toMatch(/\.sheet-body-vertical\s*\{[^}]*overflow-x:\s*hidden/)
    expect(css).toMatch(/\.sheet-body-vertical\s*\{[^}]*overscroll-behavior:\s*none/)
    expect(css).toMatch(/\.sheet-body-vertical\s*\{[^}]*touch-action:\s*pan-y/)
    expect(css).toMatch(/\.sheet-body-vertical \.chips\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/\.sheet-body-vertical \.two\s*\{[^}]*minmax\(0,\s*1fr\)/)
  })
})
