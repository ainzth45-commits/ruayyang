import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import { addMonths, monthLabel } from '../../domain/month'
import { applyDefaultToFuture } from '../../domain/plan'
import { discardReceiptUploads, entryReceipts, receiptPaymentCheck, saveReceiptChanges } from '../../domain/receipt'
import type { MonthEntry, ReceiptCheckMode, ReceiptEvidence, RecurringItem } from '../../domain/types'
import { useAction, useApp } from '../store'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { ReceiptAttachment } from './ReceiptAttachment'
import { ConfirmButton, Sheet } from './Sheet'

export function EntrySheet({ entry, item, onClose }: { entry: MonthEntry; item: RecurringItem | undefined; onClose: () => void }) {
  const { repo, toast } = useApp()
  const { busy, run } = useAction()
  const [amount, setAmount] = useState(formatBaht(entry.amount))
  const [paid, setPaid] = useState(entry.paid)
  const [note, setNote] = useState(entry.note ?? '')
  const p = parseMoneyInput(amount, { allowZero: true })
  const isIncome = item?.kind === 'income'
  const changed = p.ok && p.value !== entry.amount
  const [carry, setCarry] = useState(false)
  const [receipts, setReceipts] = useState(() => entryReceipts(entry))
  const [receiptMode, setReceiptMode] = useState(entry.receiptMode ?? null)
  const [proofChanged, setProofChanged] = useState(false)
  const [reading, setReading] = useState(false)
  const uploads = useRef<string[]>([])
  const pendingSave = useRef<Promise<unknown> | null>(null)
  const rememberUpload = useCallback((path: string) => { uploads.current.push(path) }, [])
  const changeReceipts = useCallback((next: ReceiptEvidence[], mode: ReceiptCheckMode | null) => {
    setReceipts(next); setReceiptMode(mode); setProofChanged(true)
  }, [])
  useEffect(() => () => {
    void Promise.resolve(pendingSave.current).finally(async () => {
      const warning = await discardReceiptUploads(repo, entry, uploads.current)
      if (warning) toast(warning, 'error')
    })
    // entry is the editor snapshot; the parent keys this component by entry.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, entry.id])
  const draft = { ...entry, receipts, receiptMode, receiptPath: receipts[0]?.path ?? null, amount: p.ok ? p.value : entry.amount }
  const check = receiptPaymentCheck(draft)
  const paymentBlocked = !isIncome && paid && (!entry.paid || changed || proofChanged) && check.status !== 'none' && check.status !== 'match'
  const locked = busy || reading
  return (
    <Sheet title={item?.name ?? 'รายการ'} onClose={onClose}>
      <div className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
        {monthLabel(entry.month)}{item?.isEstimate ? ' · ยอดประมาณ' : ''}
      </div>
      <div className={`amount-box ${p.ok ? '' : 'err'}`}>
        <label>ยอด (บาท)</label>
        <div className="amount-row">
          <span className="cur">฿</span>
          <input className="amount-input" {...moneyInputProps} aria-label="ยอด" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      {!p.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{p.error}</div>}
      <div className="switch">
        <span>{isIncome ? 'ได้รับแล้ว' : 'จ่ายแล้ว'}{item?.isEstimate && !isIncome && <span className="muted" style={{ fontSize: 12 }}> — แก้เป็นยอดจริงก่อนติ๊ก</span>}</span>
        <button className="toggle" role="switch" aria-checked={paid} aria-label="จ่ายแล้ว" onClick={() => setPaid(!paid)} />
      </div>
      {changed && item && (
        <div className="switch">
          <span>ใช้ยอดนี้กับเดือนถัดไปด้วย<br /><span className="muted" style={{ fontSize: 12 }}>{carry ? `ทุกเดือนหลัง ${monthLabel(entry.month)} ที่ยังไม่จ่าย` : 'ปิด = เปลี่ยนแค่เดือนนี้'}</span></span>
          <button className="toggle" role="switch" aria-checked={carry} aria-label="ใช้ยอดนี้กับเดือนถัดไปด้วย" onClick={() => setCarry(!carry)} />
        </div>
      )}
      {!isIncome && <ReceiptAttachment entry={draft} disabled={busy} onChange={changeReceipts} onBusy={setReading} onUploaded={rememberUpload} onUseAmount={(value) => setAmount(formatBaht(value))} />}
      <label className="field" style={{ marginTop: 14 }}>
        <span>โน้ต</span>
        <input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        className="btn primary"
        disabled={!p.ok || locked || paymentBlocked}
        onClick={() => {
          if (!p.ok || locked || paymentBlocked) return
          pendingSave.current = run(async () => {
            let warning: string | null = null
            const payment = { amount: p.value, paid, note: sanitizeText(note) || null }
            if (proofChanged) {
              const result = await saveReceiptChanges(repo, entry, receipts, receiptMode, payment)
              warning = result.warning
            } else await repo.updateEntry(entry.id, payment)
            if (changed && carry && item) await applyDefaultToFuture(repo, item, p.value, addMonths(entry.month, 1))
            onClose()
            return warning
          }, paid && !entry.paid ? (isIncome ? 'รับเงินแล้ว' : 'จ่ายแล้ว') : 'บันทึกแล้ว', paid && !entry.paid ? 'kaching' : 'save').then((warning) => { if (warning) toast(warning, 'error') })
        }}
      >
        บันทึก
      </button>
      <div style={{ marginTop: 10 }}>
        <ConfirmButton
          label="เอาออกจากเดือนนี้"
          confirmLabel="แตะอีกครั้งเพื่อยืนยัน"
          disabled={locked}
          onConfirm={async () => {
            const warning = await run(async () => {
              const warning = await repo.deleteEntries([entry.id])
              onClose()
              return warning
            }, 'เอาออกแล้ว', 'delete')
            if (warning) toast(warning, 'error')
          }}
        />
      </div>
    </Sheet>
  )
}
