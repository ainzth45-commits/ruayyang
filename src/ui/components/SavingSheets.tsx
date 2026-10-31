import { useState } from 'react'
import { Check, PiggyBank } from 'lucide-react'
import { cycleForDate, transactionCycle } from '../../domain/cycle'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import { addMonths, bangkokToday, dateLabel, monthLabel, monthOf } from '../../domain/month'
import { savingsTotal } from '../../domain/savings'
import type { DateKey, MonthKey, Satang, Saving } from '../../domain/types'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { useAction, useApp, useLoad } from '../store'
import { Money } from './Money'
import { DateField } from './Pickers'
import { ConfirmButton, Sheet } from './Sheet'
import { SwipeRow } from './SwipeRow'

export interface SavingValues {
  amount: Satang
  date: DateKey
  note: string | null
  cycleMonth?: MonthKey | null
}

/** ฟอร์มเก็บเงิน (ใช้ทั้งเพิ่มใหม่และแก้ไข) */
export function SavingForm(props: {
  initial?: SavingValues & { createdAt?: string }
  busy: boolean
  submitLabel: string
  autoFocus?: boolean
  onSubmit: (v: SavingValues) => void
  footer?: React.ReactNode
  /** เงินแยกเก็บตอนปิดรอบแก้ได้เฉพาะยอด/โน้ต ไม่ย้ายวันที่หรือรอบ */
  showCycle?: boolean
}) {
  const { repo } = useApp()
  const showCycle = props.showCycle ?? true
  const cycles = useLoad(() => showCycle ? repo.listMonths('2000-01', '9999-12') : Promise.resolve([]), [showCycle])
  const [amountText, setAmountText] = useState(props.initial ? formatBaht(props.initial.amount) : '')
  const [date, setDate] = useState(props.initial?.date ?? bangkokToday())
  const [note, setNote] = useState(props.initial?.note ?? '')
  const [touched, setTouched] = useState(false)
  const [cycleChoice, setCycleChoice] = useState<{ date: DateKey; month: MonthKey } | null>(null)
  const parsed = parseMoneyInput(amountText)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  const unchangedEdit = date === props.initial?.date && (props.initial?.createdAt || props.initial?.cycleMonth)
  const autoCycle = dateOk && cycles.data ? (unchangedEdit
    ? transactionCycle({ date, createdAt: props.initial?.createdAt ?? '', cycleMonth: props.initial?.cycleMonth }, cycles.data)
    : cycleForDate(date, cycles.data)) : null
  const cycleMonth = cycleChoice?.date === date ? cycleChoice.month : autoCycle
  const latestCycle = dateOk && cycles.data ? cycleForDate(date, cycles.data) : null
  const cycleOptions = [...new Set([cycleMonth, autoCycle, latestCycle, dateOk ? addMonths(monthOf(date), -1) : null])].filter((m): m is MonthKey => !!m)
  const canSave = parsed.ok && dateOk && !props.busy && (!showCycle || (!cycles.loading && cycles.data !== null && cycleMonth !== null))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (canSave && parsed.ok) props.onSubmit({ amount: parsed.value, date, note: sanitizeText(note) || null, ...(showCycle ? { cycleMonth } : {}) })
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
        {showCycle ? <DateField label="วันที่" value={date} onChange={setDate} /> : <div className="field"><span>วันที่ปิดรอบ</span><div className="input">{dateLabel(date)}</div></div>}
        <label className="field">
          <span>โน้ต (ไม่บังคับ)</span>
          <input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนเข้าออมทรัพย์" />
        </label>
      </div>
      {showCycle && cycleMonth && (
        <label className="field">
          <span>หักจากเงินรอบ</span>
          <select className="input" aria-label="หักจากเงินรอบ" value={cycleMonth} onChange={(e) => setCycleChoice({ date, month: e.target.value })}>
            {cycleOptions.map((month) => <option key={month} value={month}>ยอดปิด {monthLabel(month)}</option>)}
          </select>
          <small className="muted">วันที่เก็บเงินจริงยังเป็นวันเดิม หากเก็บก่อนปิดยอดในวันนั้น ให้เลือกรอบก่อนเพื่อไม่หักซ้ำ</small>
        </label>
      )}
      {showCycle && !cycles.data && !cycles.loading && <div>
        <p className="err-text">โหลดรอบเงินไม่สำเร็จ กรุณาลองอีกครั้งก่อนบันทึก</p>
        <button type="button" className="btn ghost" onClick={cycles.reload}>โหลดรอบเงินอีกครั้ง</button>
      </div>}
      <button className="btn primary" type="submit" disabled={!canSave}>
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
        showCycle={saving.kind !== 'close'}
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
  const { busy, run } = useAction()
  const [editing, setEditing] = useState<Saving | null>(null)
  const [adding, setAdding] = useState(false)
  const { data } = useLoad(async () => {
    const [all, settings] = await Promise.all([repo.listSavings('2000-01-01', '9999-12-31'), repo.getSettings()])
    return { all, opening: settings.savingsOpening }
  }, [])
  return (
    <Sheet title="เงินเก็บสะสม" onClose={onClose}>
      <button className="btn primary" onClick={() => setAdding(true)}><PiggyBank size={18} /> เก็บเงินเพิ่ม</button>
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
              <div className="empty">ยังไม่มีรายการเก็บเงิน แตะ "เก็บเงินเพิ่ม" เพื่อเริ่ม</div>
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
      {adding && <Sheet title="เก็บเงินเพิ่ม" onClose={() => setAdding(false)}>
        <SavingForm busy={busy} submitLabel="เก็บเงิน" autoFocus onSubmit={(v) => run(async () => {
          await repo.addSaving({ ...v, kind: 'deposit' })
          setAdding(false)
        }, 'เก็บเงินแล้ว', 'stash')} />
      </Sheet>}
      {editing && <SavingEditSheet saving={editing} onClose={() => setEditing(null)} />}
    </Sheet>
  )
}
