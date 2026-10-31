import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, addMonths, bangkokToday, daysInMonth, monthLabel, monthOf, WEEKDAYS_SHORT } from '../../domain/month'
import type { DateKey, MonthKey } from '../../domain/types'
import { revealInScroller } from '../viewport'

// ปฏิทินของแอปเอง (แทน date/month picker ของเบราว์เซอร์ที่หน้าตาไม่เข้าธีม)
// เปิดเป็นแผงกางในฟอร์ม เปิดได้ทีละอัน · ใช้ใน .two ได้ (แผงกินเต็มแถว)

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** เปิดแผงแล้วเลื่อนให้เห็นทั้งแผง (ปฏิทินมักอยู่ล่างสุดของแผ่น) */
function useRevealOnOpen(open: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    let timer = 0
    const reveal = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { if (ref.current) revealInScroller(ref.current) }, 60)
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', reveal)
    reveal()
    return () => { window.clearTimeout(timer); vv?.removeEventListener('resize', reveal) }
  }, [open])
  return ref
}

/** เปิดได้ทีละแผงทั้งแอป */
function usePickerOpen(): [boolean, (v: boolean) => void] {
  const id = useId()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== id && setOpen(false)
    window.addEventListener('picker-open', onOther)
    return () => window.removeEventListener('picker-open', onOther)
  }, [id])
  const set = (v: boolean) => {
    if (v) {
      ;(document.activeElement as HTMLElement | null)?.blur?.() // ปิดแป้นพิมพ์ที่ค้างอยู่
      window.dispatchEvent(new CustomEvent('picker-open', { detail: id }))
    }
    setOpen(v)
  }
  return [open, set]
}

function dayLabel(d: DateKey, today: DateKey): string {
  const [y, m, day] = d.split('-').map(Number)
  const wd = WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]
  const rel = d === today ? 'วันนี้ · ' : d === addDays(today, -1) ? 'เมื่อวาน · ' : ''
  return `${rel}${wd} ${day} ${MONTHS_SHORT[m - 1]} ${y}`
}

export function DateField(props: { label: string; value: DateKey; onChange: (d: DateKey) => void }) {
  const today = bangkokToday()
  const [open, setOpen] = usePickerOpen()
  const [view, setView] = useState<MonthKey>(monthOf(props.value || today))
  const panel = useRevealOnOpen(open)
  const pick = (d: DateKey) => {
    props.onChange(d)
    setOpen(false)
  }
  const [y, m] = view.split('-').map(Number)
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = daysInMonth(view)

  return (
    <>
      <div className="field">
        <span>{props.label}</span>
        <button
          type="button"
          className={`input picker-btn ${open ? 'open' : ''}`}
          aria-expanded={open}
          aria-label={`${props.label} ${dayLabel(props.value, today)}`}
          onClick={() => {
            setView(monthOf(props.value || today))
            setOpen(!open)
          }}
        >
          <span className="picker-val">{dayLabel(props.value, today)}</span>
          <CalendarDays size={18} strokeWidth={1.6} />
        </button>
      </div>
      {open && (
        <div className="picker" role="dialog" aria-label="เลือกวันที่" ref={panel}>
          <div className="picker-head">
            <button type="button" className="picker-nav" aria-label="เดือนก่อน" onClick={() => setView(addMonths(view, -1))}><ChevronLeft size={18} strokeWidth={1.8} /></button>
            <div className="picker-title">{monthLabel(view, { long: true }).split(' ')[0]} <b>{y}</b></div>
            <button type="button" className="picker-nav" aria-label="เดือนถัดไป" onClick={() => setView(addMonths(view, 1))}><ChevronRight size={18} strokeWidth={1.8} /></button>
          </div>
          <div className="picker-days">
            {WEEKDAYS_SHORT.map((w, i) => <div key={w} className={`wd ${i === 0 || i === 6 ? 'we' : ''}`}>{w}</div>)}
            {Array.from({ length: firstWd }, (_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = `${view}-${String(i + 1).padStart(2, '0')}`
              return (
                <button
                  type="button"
                  key={d}
                  className={`pd ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}`}
                  aria-pressed={d === props.value}
                  aria-label={dayLabel(d, today)}
                  onClick={() => pick(d)}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
          <div className="picker-foot">
            <button type="button" className="pill" onClick={() => pick(addDays(today, -1))}>เมื่อวาน</button>
            <button type="button" className="pill gold" onClick={() => pick(today)}>วันนี้</button>
          </div>
        </div>
      )}
    </>
  )
}

export function MonthField(props: {
  label: string
  value: MonthKey | ''
  onChange: (m: MonthKey | '') => void
  /** แสดงปุ่มล้างค่า (เช่น "ไม่มีกำหนด") */
  emptyLabel?: string
  min?: MonthKey
  invalid?: boolean
}) {
  const thisMonth = monthOf(bangkokToday())
  const [open, setOpen] = usePickerOpen()
  const [year, setYear] = useState(Number((props.value || thisMonth).slice(0, 4)))
  const panel = useRevealOnOpen(open)
  const pick = (m: MonthKey | '') => {
    props.onChange(m)
    setOpen(false)
  }
  const shown = props.value ? monthLabel(props.value, { long: true }) : props.emptyLabel ?? 'เลือกเดือน'

  return (
    <>
      <div className="field">
        <span>{props.label}</span>
        <button
          type="button"
          className={`input picker-btn ${open ? 'open' : ''} ${props.invalid ? 'err' : ''} ${props.value ? '' : 'empty'}`}
          aria-expanded={open}
          aria-label={`${props.label} ${shown}`}
          onClick={() => {
            setYear(Number((props.value || thisMonth).slice(0, 4)))
            setOpen(!open)
          }}
        >
          <span className="picker-val">{shown}</span>
          <CalendarRange size={18} strokeWidth={1.6} />
        </button>
      </div>
      {open && (
        <div className="picker" role="dialog" aria-label="เลือกเดือน" ref={panel}>
          <div className="picker-head">
            <button type="button" className="picker-nav" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}><ChevronLeft size={18} strokeWidth={1.8} /></button>
            <div className="picker-title"><b>{year}</b></div>
            <button type="button" className="picker-nav" aria-label="ปีถัดไป" onClick={() => setYear(year + 1)}><ChevronRight size={18} strokeWidth={1.8} /></button>
          </div>
          <div className="picker-months">
            {MONTHS_SHORT.map((label, i) => {
              const m = `${year}-${String(i + 1).padStart(2, '0')}`
              return (
                <button
                  type="button"
                  key={m}
                  className={`pm ${m === thisMonth ? 'today' : ''}`}
                  aria-pressed={m === props.value}
                  disabled={props.min !== undefined && m < props.min}
                  onClick={() => pick(m)}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <div className="picker-foot">
            {props.emptyLabel && <button type="button" className="pill" onClick={() => pick('')}>{props.emptyLabel}</button>}
            <button type="button" className="pill gold" disabled={props.min !== undefined && thisMonth < props.min} onClick={() => pick(thisMonth)}>เดือนนี้</button>
          </div>
        </div>
      )}
    </>
  )
}
