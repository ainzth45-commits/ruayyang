import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import type { Category, DateKey, Satang } from '../../domain/types'
import { CategoryIcon } from '../icons'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { DateField } from './Pickers'

export interface TxValues {
  amount: Satang
  date: DateKey
  categoryId: string | null
  note: string | null
}

export function TxForm(props: {
  categories: Category[]
  initial: { amount: Satang | null; date: DateKey; categoryId: string | null; note: string | null }
  busy: boolean
  submitLabel: string
  onSubmit: (v: TxValues) => void
  autoFocusAmount?: boolean
  footer?: ReactNode
  /** ใต้ช่องยอด เช่น ปุ่มสแกนสลิป */
  amountExtra?: ReactNode
  dateLabel?: string
}) {
  const [amountText, setAmountText] = useState(props.initial.amount === null ? '' : formatBaht(props.initial.amount))
  const [date, setDate] = useState(props.initial.date)
  const [categoryId, setCategoryId] = useState(props.initial.categoryId)
  const [note, setNote] = useState(props.initial.note ?? '')
  const [touched, setTouched] = useState(false)

  const parsed = parseMoneyInput(amountText)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const canSave = parsed.ok && dateOk && categoryId !== null && !props.busy
  const active = props.categories.filter((c) => !c.archived || c.id === categoryId)

  const submit = () => {
    setTouched(true)
    if (!parsed.ok || !dateOk || categoryId === null) return
    props.onSubmit({ amount: parsed.value, date, categoryId, note: sanitizeText(note) || null })
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

      <button className="btn primary" type="submit" disabled={!canSave && touched}>
        <Check size={18} strokeWidth={2} />
        {props.busy ? 'กำลังบันทึก…' : props.submitLabel}
      </button>
      {props.footer}
    </form>
  )
}
