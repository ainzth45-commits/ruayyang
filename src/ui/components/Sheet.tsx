import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const CLOSE_DY = 90 // px
const CLOSE_V = 0.6 // px/ms

export function Sheet(props: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
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
      if (a?.id === 'kb-proxy') a.blur()
    }
  }, [])

  // แตะช่องกรอก → เลื่อนช่องนั้นให้อยู่กลางแผ่น หลังแป้นขึ้นเสร็จ
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer = 0
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (!t.matches('input, textarea, select')) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280)
    }
    el.addEventListener('focusin', onFocus)
    return () => {
      el.removeEventListener('focusin', onFocus)
      window.clearTimeout(timer)
    }
  }, [])

  const close = () => {
    const el = ref.current
    if (!el || closing) return props.onClose()
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
      <div className="sheet" role="dialog" aria-modal="true" ref={ref} onAnimationEnd={(e) => e.target === e.currentTarget && e.currentTarget.classList.add('settled')}>
        <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="grabber" />
          <div className="sheet-head">
            <h3>{props.title}</h3>
            <button className="icon-btn" onClick={close} aria-label="ปิด">
              <X size={18} strokeWidth={1.6} />
            </button>
          </div>
        </div>
        {props.children}
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
