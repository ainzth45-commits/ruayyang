import { useState } from 'react'
import { Check, PiggyBank } from 'lucide-react'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import { bangkokToday, dateLabel } from '../../domain/month'
import { savingsTotal } from '../../domain/savings'
import type { DateKey, Satang, Saving } from '../../domain/types'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { useAction, useApp, useLoad } from '../store'
import { Money } from './Money'
import { ConfirmButton, Sheet } from './Sheet'
import { SwipeRow } from './SwipeRow'

export interface SavingValues {
  amount: Satang
  date: DateKey
  note: string | null
}

/** ฟอร์มเก็บเงิน (ใช้ทั้งเพิ่มใหม่และแก้ไข) */
export function SavingForm(props: {
  initial?: SavingValues
  busy: boolean
  submitLabel: string
  autoFocus?: boolean
  onSubmit: (v: SavingValues) => void
  footer?: React.ReactNode
}) {
  const [amountText, setAmountText] = useState(props.initial ? formatBaht(props.initial.amount) : '')
  const [date, setDate] = useState(props.initial?.date ?? bangkokToday())
  const [note, setNote] = useState(props.initial?.note ?? '')
  const [touched, setTouched] = useState(false)
  const parsed = parseMoneyInput(amountText)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (parsed.ok && dateOk) props.onSubmit({ amount: parsed.value, date, note: sanitizeText(note) || null })
      }}
    >
      <div className={`amount-box holo ${touched && !parsed.ok ? 'err' : ''}`}>
        <label htmlFor="saving-amount">เก็บเงิน (บาท)</label>
        <div className="amount-row">
          <span className="cur">฿</span>
          <input
            id="saving-amount"
            className="amount-input"
            {...moneyInputProps}
            placeholder="0.00"
            aria-label="ยอดเก็บเงิน"
            value={amountText}
            autoFocus={props.autoFocus}
            onChange={(e) => setAmountText(e.target.value)}
            onBlur={() => parsed.ok && setAmountText(formatBaht(parsed.value))}
          />
        </div>
      </div>
      {touched && !parsed.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{parsed.error}</div>}
      <p className="muted" style={{ fontSize: 12.5, margin: '-6px 4px 14px' }}>เงินเก็บไม่นับเป็นรายจ่าย งบใช้จ่ายจะไม่ลดลง</p>
      <div className="two">
        <label className="field">
          <span>วันที่</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>โน้ต (ไม่บังคับ)</span>
          <input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนเข้าออมทรัพย์" />
        </label>
      </div>
      <button className="btn primary" type="submit" disabled={props.busy}>
        <Check size={18} strokeWidth={2} />
        {props.busy ? 'กำลังบันทึก…' : props.submitLabel}
      </button>
      {props.footer}
    </form>
  )
}

function SavingEditSheet({ saving, onClose }: { saving: Saving; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  return (
    <Sheet title={saving.kind === 'close' ? 'แยกเก็บตอนปิดเดือน' : 'แก้ไขเงินเก็บ'} onClose={onClose}>
      <SavingForm
        initial={saving}
        busy={busy}
        submitLabel="บันทึกการแก้ไข"
        onSubmit={(v) =>
          run(async () => {
            // รายการปิดเดือนต้องอยู่วันสุดท้ายของเดือนเสมอ → แก้ได้เฉพาะยอด/โน้ต
            await repo.updateSaving(saving.id, saving.kind === 'close' ? { amount: v.amount, note: v.note } : v)
            onClose()
          }, 'แก้ไขแล้ว', 'save')
        }
        footer={
          <div style={{ marginTop: 10 }}>
            <ConfirmButton
              label="ลบรายการนี้"
              confirmLabel="แตะอีกครั้งเพื่อยืนยันการลบ"
              disabled={busy}
              onConfirm={() =>
                run(async () => {
                  await repo.deleteSaving(saving.id)
                  onClose()
                }, 'ลบแล้ว', 'delete')
              }
            />
          </div>
        }
      />
    </Sheet>
  )
}

/** ประวัติเงินเก็บทั้งหมด + ยอดสะสม */
export function SavingsSheet({ onClose }: { onClose: () => void }) {
  const { repo } = useApp()
  const { run } = useAction()
  const [editing, setEditing] = useState<Saving | null>(null)
  const { data } = useLoad(async () => {
    const [all, settings] = await Promise.all([repo.listSavings('2000-01-01', '9999-12-31'), repo.getSettings()])
    return { all, opening: settings.savingsOpening }
  }, [])
  return (
    <Sheet title="เงินเก็บสะสม" onClose={onClose}>
      {!data ? (
        <div className="empty">กำลังโหลด…</div>
      ) : (
        <>
          <div className="savings-card" style={{ marginBottom: 16 }}>
            <span className="glyph holo"><PiggyBank size={22} strokeWidth={1.6} /></span>
            <div>
              <div className="l">รวมทั้งหมด</div>
              <div className="v">{formatBaht(savingsTotal(data.opening, data.all))}</div>
              <div className="s">ยอดตั้งต้น {formatBaht(data.opening)} · แก้ได้ในหน้าตั้งค่า</div>
            </div>
          </div>
          <div className="list">
            {data.all.length === 0 ? (
              <div className="empty">ยังไม่มีรายการเก็บเงิน แตะปุ่มทองแล้วเลือก "เก็บเงิน"</div>
            ) : (
              data.all.map((s) => (
                <SwipeRow key={s.id} onDelete={() => run(() => repo.deleteSaving(s.id), 'ลบแล้ว', 'delete')}>
                  <button className="row" onClick={() => setEditing(s)}>
                    <span className="glyph holo"><PiggyBank size={18} strokeWidth={1.6} /></span>
                    <span>
                      <div className="title">{s.note || (s.kind === 'close' ? 'แยกเก็บตอนปิดเดือน' : 'เก็บเงิน')}</div>
                      <div className="meta-t">{dateLabel(s.date)}{s.kind === 'close' ? ' · ปิดเดือน' : ''}</div>
                    </span>
                    <Money v={s.amount} className="amt pos" />
                  </button>
                </SwipeRow>
              ))
            )}
          </div>
        </>
      )}
      {editing && <SavingEditSheet saving={editing} onClose={() => setEditing(null)} />}
    </Sheet>
  )
}
