import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

const OPEN_X = -84
const AXIS_LOCK = 8 // px ก่อนตัดสินว่าลากแนวนอนหรือเลื่อนแนวตั้ง

/** ปัดซ้ายโชว์ปุ่ม "ลบ" แบบแอป Mail · แตะปุ่มถึงลบ (เท่ากับยืนยัน) · เปิดค้างได้ทีละแถว */
export function SwipeRow({ children, onDelete, disabled }: { children: ReactNode; onDelete: () => void; disabled?: boolean }) {
  const id = useId()
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ x0: number; y0: number; base: number; axis: 'x' | 'y' | null; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== id && setX(0)
    window.addEventListener('swipe-open', onOther)
    return () => window.removeEventListener('swipe-open', onOther)
  }, [id])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return
    g.current = { x0: e.clientX, y0: e.clientY, base: x, axis: null, moved: false }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (!s) return
    const dx = e.clientX - s.x0
    const dy = e.clientY - s.y0
    if (!s.axis) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (s.axis === 'x') {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        window.dispatchEvent(new CustomEvent('swipe-open', { detail: id }))
      }
    }
    if (s.axis !== 'x') return
    s.moved = true
    setX(Math.min(0, Math.max(OPEN_X * 1.4, s.base + dx)))
  }
  const up = () => {
    const s = g.current
    g.current = null
    setDragging(false)
    if (!s?.moved) return
    suppressClick.current = true
    setX((cur) => (cur < OPEN_X / 2 ? OPEN_X : 0))
  }

  return (
    <div className="swipe">
      <button type="button" className="swipe-del" aria-label="ลบ" tabIndex={x === 0 ? -1 : 0} onClick={() => { setX(0); onDelete() }}>
        <Trash2 size={18} strokeWidth={1.8} />
        ลบ
      </button>
      <div
        className={`swipe-body ${dragging ? 'dragging' : ''}`}
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          // ลากเสร็จ หรือแถวเปิดค้างอยู่ → แตะ = ปิด ไม่เปิดรายการ
          if (suppressClick.current || x !== 0) {
            suppressClick.current = false
            e.preventDefault()
            e.stopPropagation()
            setX(0)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
