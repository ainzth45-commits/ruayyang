import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, PiggyBank } from 'lucide-react'
import { entryStatus } from '../../domain/calc'
import { formatBaht, parseMoneyInput } from '../../domain/money'
import { bangkokToday, monthLabel, monthOf } from '../../domain/month'
import { closeMonth, isMonthClosed } from '../../domain/savings'
import type { MonthEntry, MonthKey, RecurringItem } from '../../domain/types'
import { moneyInputProps } from '../inputs'
import { loadMonth } from '../monthData'
import { useAction, useApp, useLoad } from '../store'
import { Money } from './Money'
import { Sheet } from './Sheet'
import { primeKeyboard } from '../viewport'

const STEPS = ['รายการประจำ', 'คงเหลือจริง', 'สรุปเดือน', 'แยกเก็บ']

/** ปิดเดือนแบบที่เจ้าของทำในชีต: จ่ายประจำให้ครบ → ใส่คงเหลือ → ดูรายได้เพิ่ม → แยกเก็บ */
export function CloseMonthSheet({ month, onClose }: { month: MonthKey; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const { data } = useLoad(() => loadMonth(repo, month), [month])
  const [step, setStep] = useState(0)
  const [balText, setBalText] = useState<string | null>(null)
  const [negative, setNegative] = useState<boolean | null>(null)
  const [saveText, setSaveText] = useState<string | null>(null)

  if (!data) return <Sheet title={`ปิดยอด ${monthLabel(month)}`} onClose={onClose}><div className="empty">กำลังโหลด…</div></Sheet>

  const s = data.summary
  const editing = isMonthClosed(data.record ?? undefined)
  const itemById = new Map(data.items.map((i) => [i.id, i]))
  const open = data.entries
    .filter((e) => !e.paid && itemById.get(e.itemId)?.kind !== 'income')
    .sort((a, b) => (itemById.get(a.itemId)?.sort ?? 999) - (itemById.get(b.itemId)?.sort ?? 999))

  // ค่าเริ่มต้นจากที่บันทึกไว้แล้ว (แก้การปิดเดือน)
  const balInit = s.actualBalance
  const balStr = balText ?? (balInit === null ? '' : formatBaht(Math.abs(balInit)))
  const isNeg = negative ?? (balInit !== null && balInit < 0)
  const bal = parseMoneyInput(balStr, { allowZero: true })
  const actual = bal.ok ? (isNeg ? -bal.value : bal.value) : null
  const planLeft = s.planLeft
  const extra = actual === null ? null : actual - planLeft
  // ค่าเริ่ม 0: คงเหลือจริงคือเงินตั้งต้นใช้เดือนหน้า ถ้าแยกเก็บหมดจะไม่เหลือใช้
  const saveDefault = s.savedAtClose
  const saveStr = saveText ?? formatBaht(saveDefault)
  const save = parseMoneyInput(saveStr, { allowZero: true })

  const saveFits = save.ok && actual !== null && save.value <= Math.max(0, actual)
  const canNext = !busy && month <= monthOf(bangkokToday()) && (step === 0 ? open.length === 0 : step === 1 ? actual !== null : step === 3 ? saveFits : true)

  const finish = () =>
    actual !== null &&
    save.ok &&
    saveFits &&
    run(async () => {
      await closeMonth(repo, month, actual, save.value, new Date().toISOString())
      onClose()
    }, editing ? 'แก้ยอดปิดแล้ว' : save.value > 0 ? `เริ่มเงินรอบใหม่แล้ว · แยกเก็บ ${formatBaht(save.value)} บาท` : 'เริ่มเงินรอบใหม่แล้ว', 'kaching')

  return (
    <Sheet title={`${editing ? 'แก้ยอดปิด' : 'ปิดยอด'} ${monthLabel(month)}`} onClose={onClose}>
      <div className="steps" aria-label={`ขั้นที่ ${step + 1} จาก ${STEPS.length}`}>
        {STEPS.map((label, i) => (
          <div key={label} className={`step-dot ${i === step ? 'on' : i < step ? 'done' : ''}`}>
            <i>{i < step ? <Check size={12} strokeWidth={2.4} /> : i + 1}</i>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <p className="muted step-lead">จ่ายรายการประจำให้ครบก่อน แก้ยอดประมาณให้เป็นยอดจริงแล้วแตะ ✓</p>
          {open.length === 0 ? (
            <div className="done-note"><Check size={18} strokeWidth={2} /> จ่ายครบทุกรายการแล้ว</div>
          ) : (
            <div className="list">
              {open.map((e) => (
                <OpenEntryRow key={`${e.id}-${e.amount}`} entry={e} item={itemById.get(e.itemId)} />
              ))}
            </div>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <p className="muted step-lead">{editing ? 'แก้ยอดตั้งต้น ณ เวลาเปิดรอบเดิม ก่อนแยกเก็บ ไม่ใช่ยอดคงเหลือปัจจุบัน รายจ่ายหลังเปิดรอบจะยังถูกหักตามเดิม' : 'ยอดเงินจริงที่พร้อมใช้หลังรับเงินเดือนและจ่ายบิล (รวมเงินเก่าที่เหลือแล้ว ก่อนแยกเก็บ) ระบบจะใช้ยอดนี้ทันที ไม่บวกเงินเก่าซ้ำ'}</p>
          <div className={`amount-box ${balStr && !bal.ok ? 'err' : ''}`}>
            <label htmlFor="close-balance">คงเหลือจริง (บาท)</label>
            <div className="amount-row">
              <span className="cur">{isNeg ? '−฿' : '฿'}</span>
              <input id="close-balance" className="amount-input" {...moneyInputProps} placeholder="0.00" autoFocus value={balStr} onChange={(e) => setBalText(e.target.value)} />
            </div>
          </div>
          {balStr && !bal.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{bal.error}</div>}
          <div className="switch">
            <span>ติดลบ (ใช้เกินเงินที่มี)</span>
            <button type="button" className="toggle" role="switch" aria-checked={isNeg} aria-label="ติดลบ" onClick={() => setNegative(!isNeg)} />
          </div>
        </>
      )}

      {step === 2 && actual !== null && (
        <div className="panel" style={{ padding: '8px 20px' }}>
          <div className="ledger-line"><span>รายรับ</span><Money v={s.income} /></div>
          <div className="ledger-line"><span>จ่ายประจำ</span><Money v={-s.fixedExpense} /></div>
          <div className="ledger-line"><span>แผนเงินพร้อมใช้รอบใหม่</span><Money v={planLeft} /></div>
          <div className="ledger-line"><span>คงเหลือจริง</span><Money v={actual} /></div>
          <div className="ledger-line total">
            <span>เงินเกินแผน</span>
            <Money v={extra ?? 0} className={extra !== null && extra < 0 ? 'neg' : 'pos'} />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>
            = คงเหลือจริง − แผนเหลือ (รายได้เสริม + เงินที่เหลือจากรอบก่อน)
          </p>
        </div>
      )}

      {step === 3 && (
        <>
          <p className="muted step-lead">ย้ายไปเก็บเท่าไหร่ ที่เหลือคือเงินพร้อมใช้รอบใหม่ทันที</p>
          <div className={`amount-box holo ${save.ok ? '' : 'err'}`}>
            <label htmlFor="close-save">แยกเก็บ (บาท)</label>
            <div className="amount-row">
              <span className="cur"><PiggyBank size={24} strokeWidth={1.6} /></span>
              <input id="close-save" className="amount-input" {...moneyInputProps} placeholder="0.00" autoFocus value={saveStr} onChange={(e) => setSaveText(e.target.value)} />
            </div>
          </div>
          {!save.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{save.error}</div>}
          {actual !== null && (
            <div className="chips" style={{ margin: '-4px -20px 12px' }}>
              <button type="button" className="chip-btn" onClick={() => setSaveText('0')}>ไม่เก็บ</button>
              {extra !== null && extra > 0 && <button type="button" className="chip-btn" onClick={() => setSaveText(formatBaht(extra))}>เงินเกินแผน <b>{formatBaht(extra)}</b></button>}
              {actual > 0 && <button type="button" className="chip-btn" onClick={() => setSaveText(formatBaht(actual))}>ทั้งหมด <b>{formatBaht(actual)}</b></button>}
            </div>
          )}
          {actual !== null && save.ok && (
            <div className="ledger-line total" style={{ borderBottom: 0 }}>
              <span>เงินพร้อมใช้รอบใหม่</span>
              <Money v={actual - save.value} className={actual - save.value < 0 ? 'neg' : 'pos'} />
            </div>
          )}
        </>
      )}

      {step === 3 && save.ok && !saveFits && <p className="err-text">ยอดแยกเก็บต้องไม่เกินเงินคงเหลือจริง</p>}
      <div className="step-nav">
        {step > 0 && (
          <button type="button" className="btn ghost" onClick={() => setStep(step - 1)} disabled={busy}>
            <ArrowLeft size={18} strokeWidth={1.8} /> ย้อน
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn primary" disabled={!canNext} onClick={() => { if (step + 1 === 1 || step + 1 === 3) primeKeyboard(); setStep(step + 1) }}>
            ถัดไป <ArrowRight size={18} strokeWidth={1.8} />
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!canNext || busy} onClick={finish}>
            <Check size={18} strokeWidth={2} /> {busy ? 'กำลังบันทึก…' : editing ? 'บันทึกแก้ยอดปิด' : 'ปิดยอดและเริ่มรอบใหม่'}
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** รายการประจำที่ยังไม่จ่าย: แก้ยอดแล้วแตะ ✓ = จ่ายแล้ว */
function OpenEntryRow({ entry, item }: { entry: MonthEntry; item: RecurringItem | undefined }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [text, setText] = useState(formatBaht(entry.amount))
  const p = parseMoneyInput(text, { allowZero: true })
  const isIncome = item?.kind === 'income'
  const st = entryStatus(entry, item)
  return (
    <div className="row open-entry">
      <span>
        <div className="title">{item?.name ?? 'รายการที่ถูกลบ'}</div>
        <div className="meta-t">{isIncome ? 'รายรับ' : st === 'estimate' ? 'ยอดประมาณ' : 'รอจ่าย'}</div>
      </span>
      <input className={`input num mini ${p.ok ? '' : 'err'}`} {...moneyInputProps} aria-label={`ยอด ${item?.name ?? ''}`} value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="button"
        className="check-btn"
        aria-label={isIncome ? 'ได้รับแล้ว' : 'จ่ายแล้ว'}
        disabled={!p.ok || busy}
        onClick={() => p.ok && run(() => repo.updateEntry(entry.id, { amount: p.value, paid: true }), isIncome ? 'รับเงินแล้ว' : 'จ่ายแล้ว', 'kaching')}
      >
        <Check size={18} strokeWidth={2.2} />
      </button>
    </div>
  )
}
