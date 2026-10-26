import { useState } from 'react'
import { Check } from 'lucide-react'
import { avgDailySpend } from '../../domain/budget'
import { formatBaht, parseMoneyInput } from '../../domain/money'
import { addMonths, monthEndDate, monthLabel, monthStartDate } from '../../domain/month'
import type { MonthKey, Satang } from '../../domain/types'
import { moneyInputProps } from '../inputs'
import { useAction, useApp, useLoad } from '../store'
import { Sheet } from './Sheet'

/** ตั้งงบใช้จ่ายรายวันของเดือน — เดือนถัดไปใช้ค่านี้ต่ออัตโนมัติจนกว่าจะตั้งใหม่ */
export function BudgetSheet({ month, current, onClose }: { month: MonthKey; current: Satang | null; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [text, setText] = useState(current === null ? '' : formatBaht(current))
  const p = parseMoneyInput(text, { allowZero: true })
  const avg = useLoad(async () => {
    const txs = await repo.listTransactions(monthStartDate(addMonths(month, -3)), monthEndDate(addMonths(month, -1)))
    return avgDailySpend(txs, month, 3)
  }, [month])

  const save = () =>
    p.ok &&
    run(async () => {
      await repo.setMonthBudget(month, p.value)
      onClose()
    }, `ตั้งงบ ${formatBaht(p.value, { decimals: false })} บาทแล้ว`, 'save')

  return (
    <Sheet title={`งบใช้จ่าย ${monthLabel(month)}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 13.5 }}>
        เงินที่ตั้งใจใช้กับรายจ่ายรายวันทั้งเดือน (ไม่รวมรายการประจำ) · เดือนถัดไปใช้ยอดนี้ต่อให้เอง
      </p>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className={`amount-box ${p.ok || !text ? '' : 'err'}`}>
          <label htmlFor="budget-amount">งบต่อเดือน (บาท)</label>
          <div className="amount-row">
            <span className="cur">฿</span>
            <input id="budget-amount" className="amount-input" {...moneyInputProps} placeholder="0" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        {text && !p.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{p.error}</div>}
        {avg.data != null && (
          <button type="button" className="hint-btn" onClick={() => setText(formatBaht(Math.ceil(avg.data! / 10_000) * 10_000, { decimals: false }))}>
            ใช้รายวันเฉลี่ย 3 เดือนล่าสุด <b>{formatBaht(avg.data, { decimals: false })}</b> — แตะเพื่อใช้ยอดนี้
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!p.ok || busy}>
          <Check size={18} strokeWidth={2} /> บันทึกงบ
        </button>
      </form>
    </Sheet>
  )
}
