import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { revealInScroller } from '../viewport'

const CLOSE_DY = 90 // px
const CLOSE_V = 0.6 // px/ms

export function Sheet(props: { title: ReactNode; onClose: () => void; children: ReactNode; verticalOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const drag = useRef<{ y: number; t: number; dy: number; id: number } | null>(null)
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // ช่องลับที่ใช้เปิดแป้น (primeKeyboard) ห้ามค้าง focus หลังแผ่นปิด
      const a = document.activeElement as HTMLElement | null
      if (a?.id === 'kb-proxy' || ref.current?.contains(a)) a?.blur()
    }
  }, [])

  // Safari รุ่นที่ยังเด้งตรงขอบ: ให้เลื่อนแค่เนื้อหาที่มี และไม่ส่ง gesture ไปหน้าข้างหลัง
  useEffect(() => {
    const body = bodyRef.current
    if (!props.verticalOnly || !body) return
    let gesture: { x: number; y: number; lastY: number } | null = null
    const start = (event: TouchEvent) => {
      const point = event.touches[0]
      gesture = event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY, lastY: point.clientY } : null
    }
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return
      const point = event.touches[0]
      const dx = point.clientX - gesture.x
      const totalY = point.clientY - gesture.y
      const dy = point.clientY - gesture.lastY
      gesture.lastY = point.clientY
      if (Math.max(Math.abs(dx), Math.abs(totalY)) < 4) return
      if (Math.abs(dx) > Math.abs(totalY)) {
        event.preventDefault()
        return
      }
      // ให้ textarea ที่มีเนื้อหายาวเลื่อนเองได้ ก่อนส่งต่อให้พื้นที่ฟอร์ม
      let node = event.target instanceof Element ? event.target : null
      while (node && body.contains(node)) {
        if (node instanceof HTMLElement && (node === body || /auto|scroll/.test(getComputedStyle(node).overflowY))) {
          const max = node.scrollHeight - node.clientHeight
          if (max > 0 && ((dy < 0 && node.scrollTop < max - 1) || (dy > 0 && node.scrollTop > 1))) return
        }
        if (node === body) break
        node = node.parentElement
      }
      event.preventDefault()
    }
    const end = () => { gesture = null }
    body.addEventListener('touchstart', start, { passive: true })
    body.addEventListener('touchmove', move, { passive: false })
    body.addEventListener('touchend', end)
    body.addEventListener('touchcancel', end)
    return () => {
      body.removeEventListener('touchstart', start)
      body.removeEventListener('touchmove', move)
      body.removeEventListener('touchend', end)
      body.removeEventListener('touchcancel', end)
    }
  }, [props.verticalOnly])

  // เลื่อนเฉพาะเนื้อหาแผ่น ไม่ใช้ scrollIntoView ที่ Safari อาจเลื่อนทั้งหน้า
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let timer = 0
    let focused: HTMLElement | null = null
    const reveal = () => {
      if (!focused || !el.contains(focused)) return
      revealInScroller(focused)
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(reveal, 120)
    }
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (!t.matches('input, textarea, select')) return
      focused = t
      schedule()
    }
    const onBlur = () => { focused = null; window.clearTimeout(timer) }
    el.addEventListener('focusin', onFocus)
    el.addEventListener('focusout', onBlur)
    const vv = window.visualViewport
    vv?.addEventListener('resize', schedule)
    vv?.addEventListener('scroll', schedule)
    const active = document.activeElement as HTMLElement | null
    if (active && el.contains(active)) { focused = active; schedule() }
    return () => {
      el.removeEventListener('focusin', onFocus)
      el.removeEventListener('focusout', onBlur)
      vv?.removeEventListener('resize', schedule)
      vv?.removeEventListener('scroll', schedule)
      window.clearTimeout(timer)
    }
  }, [])

  const close = () => {
    const el = ref.current
    if (!el || closing) return props.onClose()
    const active = document.activeElement as HTMLElement | null
    if (active && (el.contains(active) || active.id === 'kb-proxy')) active.blur()
    setClosing(true)
    el.classList.add('closing')
    el.style.transform = 'translateY(100%)'
    window.setTimeout(() => onCloseRef.current(), 190)
  }

  // ปัดลงที่ grabber/หัวแผ่นเพื่อปิด
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    ref.current?.classList.add('dragging')
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !ref.current) return
    d.dy = Math.max(0, e.clientY - d.y)
    ref.current.style.transform = `translateY(${d.dy}px)`
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    const el = ref.current
    if (!d || !el) return
    el.classList.remove('dragging')
    const v = d.dy / Math.max(1, performance.now() - d.t)
    if (d.dy > CLOSE_DY || (d.dy > 24 && v > CLOSE_V)) return close()
    el.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'
    el.style.transform = ''
    window.setTimeout(() => el && (el.style.transition = ''), 260)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // portal ไป body: กันโดน stacking context ของ .page (animation) ทับจนจมใต้แถบเมนู
  return createPortal(
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet-viewport">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onAnimationEnd={(e) => e.target === e.currentTarget && e.currentTarget.classList.add('settled')}>
        <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="grabber" />
          <div className="sheet-head">
            <h3 id={titleId}>{props.title}</h3>
            <button className="icon-btn" onClick={close} aria-label="ปิด">
              <X size={18} strokeWidth={1.6} />
            </button>
          </div>
        </div>
        <div className={`sheet-body${props.verticalOnly ? ' sheet-body-vertical' : ''}`} ref={bodyRef}>{props.children}</div>
      </div>
      </div>
    </>,
    document.body,
  )
}

/** ปุ่มอันตรายแบบกดสองจังหวะ (แทน confirm() ที่บล็อกหน้าเว็บ) */
export function ConfirmButton(props: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className="btn danger" disabled={props.disabled} onClick={() => (armed ? props.onConfirm() : setArmed(true))}>
      {armed ? props.confirmLabel : props.label}
    </button>
  )
}
