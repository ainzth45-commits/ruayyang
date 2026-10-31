import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cycleForDate, transactionCycle } from '../../domain/cycle'
import { addMonths, monthLabel, monthOf } from '../../domain/month'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import type { Category, DateKey, MonthKey, Satang } from '../../domain/types'
import { CategoryIcon } from '../icons'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { DateField } from './Pickers'
import { useApp, useLoad } from '../store'

export interface TxValues {
  amount: Satang
  date: DateKey
  categoryId: string | null
  note: string | null
  cycleMonth?: MonthKey | null
}

export function TxForm(props: {
  categories: Category[]
  initial: { amount: Satang | null; date: DateKey; categoryId: string | null; note: string | null; cycleMonth?: MonthKey | null; createdAt?: string }
  busy: boolean
  submitLabel: string
  onSubmit: (v: TxValues) => void
  autoFocusAmount?: boolean
  footer?: ReactNode
  /** ใต้ช่องยอด เช่น ปุ่มสแกนสลิป */
  amountExtra?: ReactNode
  dateLabel?: string
}) {
  const { repo } = useApp()
  const cycles = useLoad(() => repo.listMonths('2000-01', '9999-12'), [])
  const [amountText, setAmountText] = useState(props.initial.amount === null ? '' : formatBaht(props.initial.amount))
  const [date, setDate] = useState(props.initial.date)
  const [categoryId, setCategoryId] = useState(props.initial.categoryId)
  const [note, setNote] = useState(props.initial.note ?? '')
  const [touched, setTouched] = useState(false)
  const [cycleChoice, setCycleChoice] = useState<{ date: string; month: MonthKey } | null>(null)

  const parsed = parseMoneyInput(amountText)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  const autoCycle = dateOk && cycles.data ? (date === props.initial.date && props.initial.createdAt
    ? transactionCycle({ date, createdAt: props.initial.createdAt, cycleMonth: props.initial.cycleMonth }, cycles.data)
    : cycleForDate(date, cycles.data)) : null
  const cycleMonth = cycleChoice?.date === date ? cycleChoice.month : autoCycle
  const latestCycle = dateOk && cycles.data ? cycleForDate(date, cycles.data) : null
  const cycleOptions = [...new Set([cycleMonth, autoCycle, latestCycle, dateOk ? addMonths(monthOf(date), -1) : null])].filter((m): m is string => !!m)
  const canSave = parsed.ok && dateOk && categoryId !== null && cycleMonth !== null && !props.busy && !cycles.loading
  const active = props.categories.filter((c) => !c.archived || c.id === categoryId)

  const submit = () => {
    setTouched(true)
    if (!canSave || !parsed.ok) return
    props.onSubmit({ amount: parsed.value, date, categoryId, note: sanitizeText(note) || null, cycleMonth })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className={`amount-box ${touched && !parsed.ok ? 'err' : ''}`}>
        <label htmlFor="tx-amount">จำนวนเงิน (บาท)</label>
        <div className="amount-row">
        <span className="cur">฿</span>
        <input
          id="tx-amount"
          className="amount-input"
          {...moneyInputProps}
          placeholder="0.00"
          aria-label="จำนวนเงิน"
          value={amountText}
          autoFocus={props.autoFocusAmount}
          onChange={(e) => setAmountText(e.target.value)}
          onBlur={() => parsed.ok && setAmountText(formatBaht(parsed.value))}
        />
        </div>
      </div>
      {touched && !parsed.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{parsed.error}</div>}
      {props.amountExtra}

      <div className="section-head" style={{ marginBottom: 0 }}><h2>เป็นค่าอะไร</h2></div>
      <div className="cat-grid" role="group" aria-label="หมวด">
        {active.map((c) => (
          <button type="button" key={c.id} className="cat" aria-pressed={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
            <CategoryIcon name={c.icon} size={20} />
            {c.name}
          </button>
        ))}
      </div>
      {touched && categoryId === null && <div className="err-text" style={{ marginTop: -8, marginBottom: 12 }}>เลือกหมวดก่อนนะ</div>}

      <div className="two">
        <DateField label={props.dateLabel ?? 'วันที่'} value={date} onChange={setDate} />
        <label className="field">
          <span>โน้ต (ไม่บังคับ)</span>
          <input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ข้าวเที่ยง" />
        </label>
      </div>

      {cycleMonth && (
        <label className="field">
          <span>หักจากเงินรอบ</span>
          <select className="input" aria-label="หักจากเงินรอบ" value={cycleMonth} onChange={(e) => setCycleChoice({ date, month: e.target.value })}>
            {cycleOptions.map((m) => <option key={m} value={m}>ยอดปิด {monthLabel(m)}</option>)}
          </select>
          <small className="muted">วันที่ใช้เงินจริงยังเป็นวันเดิม หากใช้ก่อนปิดยอดในวันนั้น ให้เลือกรอบก่อน</small>
        </label>
      )}
      {!cycles.data && !cycles.loading && <button type="button" className="btn ghost" onClick={cycles.reload}>โหลดรอบเงินอีกครั้ง</button>}
      <button className="btn primary" type="submit" disabled={!canSave}>
        <Check size={18} strokeWidth={2} />
        {props.busy ? 'กำลังบันทึก…' : props.submitLabel}
      </button>
      {props.footer}
    </form>
  )
}
