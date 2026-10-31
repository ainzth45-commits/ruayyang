import { useState } from 'react'
import { ChevronRight, Paperclip } from 'lucide-react'
import { entryStatus } from '../../domain/calc'
import { monthLabel } from '../../domain/month'
import type { MonthEntry, MonthKey, RecurringItem } from '../../domain/types'
import { Money } from './Money'
import { EntrySheet } from './EntrySheet'

const STATUS_LABEL = { paid: 'จ่ายแล้ว', estimate: 'ยอดประมาณ', pending: 'รอจ่าย' } as const

/** ประวัติบิลตามเดือนที่จ่าย แยกจากการใช้จ่ายรายวันและรอบเงินพร้อมใช้ */
export function FixedCalendar({ month, entries, items }: { month: MonthKey; entries: MonthEntry[]; items: RecurringItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const bills = entries
    .filter((entry) => entry.month === month && itemById.get(entry.itemId)?.kind !== 'income')
    .sort((a, b) => (itemById.get(a.itemId)?.sort ?? 999) - (itemById.get(b.itemId)?.sort ?? 999))
  const total = bills.reduce((sum, entry) => sum + entry.amount, 0)
  const paid = bills.filter((entry) => entry.paid)
  const paidTotal = paid.reduce((sum, entry) => sum + entry.amount, 0)
  const selected = bills.find((entry) => entry.id === selectedId)

  return (
    <>
      <section className="panel calendar-summary" aria-label="สรุปจ่ายประจำ">
        <div className="ledger-line"><span>ยอดบิลทั้งหมด</span><Money v={total} /></div>
        <div className="ledger-line"><span>จ่ายแล้ว {paid.length}/{bills.length} รายการ</span><Money v={paidTotal} className="pos" /></div>
        <div className="ledger-line total"><span>ยังไม่จ่าย</span><Money v={total - paidTotal} /></div>
      </section>
      <p className="swipe-hint">บิลของ {monthLabel(month)} · ไม่รวมใช้จ่ายรายวัน</p>

      <div className="section">
        <div className="section-head"><h2>รายการจ่ายประจำ</h2><span className="aside">แตะเพื่อดูหลักฐาน</span></div>
        <div className="list">
          {bills.length === 0 ? <div className="empty">ไม่มีรายการจ่ายประจำเดือนนี้</div> : bills.map((entry) => {
            const item = itemById.get(entry.itemId)
            const status = entryStatus(entry, item)
            return (
              <button key={entry.id} className="row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }} onClick={() => setSelectedId(entry.id)}>
                <span>
                  <span className="title">{item?.name ?? 'รายการที่ถูกลบ'}</span>
                  <span className="meta-t">{STATUS_LABEL[status]}{entry.receiptPath && <> · <Paperclip size={12} aria-hidden /> มีหลักฐาน</>}</span>
                </span>
                <Money v={entry.amount} className="amt" />
                <ChevronRight size={16} className="muted" aria-hidden />
              </button>
            )
          })}
        </div>
      </div>

      {selected && <EntrySheet key={selected.id} entry={selected} item={itemById.get(selected.itemId)} onClose={() => setSelectedId(null)} />}
    </>
  )
}
