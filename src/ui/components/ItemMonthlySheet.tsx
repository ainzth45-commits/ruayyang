import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { entryStatus } from '../../domain/calc'
import { monthLabel } from '../../domain/month'
import type { MonthEntry, MonthKey, RecurringItem } from '../../domain/types'
import { useApp, useLoad } from '../store'
import { revealInScroller } from '../viewport'
import { Money } from './Money'
import { Sheet } from './Sheet'

const STATUS_LABEL = { paid: 'จ่ายแล้ว', estimate: 'ยอดประมาณ', pending: 'รอจ่าย' } as const

/** ดูยอดที่ลงไว้ของรายการเดียวกันทุกเดือน โดยไม่สร้างหรือเขียนแผนเพิ่ม */
export function ItemMonthlySheet({ item, currentMonth, onSelect, onClose }: {
  item: RecurringItem
  currentMonth: MonthKey
  onSelect: (entry: MonthEntry) => void
  onClose: () => void
}) {
  const { repo } = useApp()
  const currentRow = useRef<HTMLButtonElement>(null)
  const scope = item.id
  const { data, loading, reload } = useLoad(async () => {
    // แก้ช่วงเริ่ม/เลิกรายการภายหลังได้ แต่รายการที่เคยลงไว้ยังเป็นประวัติ
    const entries = await repo.listEntries('2000-01', '9999-12')
    return {
      scope,
      entries: entries.filter((entry) => entry.itemId === item.id).sort((a, b) => a.month.localeCompare(b.month)),
    }
  }, [scope])
  const current = data?.scope === scope ? data : null

  useEffect(() => {
    if (currentRow.current) revealInScroller(currentRow.current)
  }, [current, currentMonth])

  return (
    <Sheet title={<span style={{ overflowWrap: 'anywhere' }}>ยอดแต่ละเดือน · {item.name}</span>} onClose={onClose}>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', overflowWrap: 'anywhere' }}>แตะเดือนเพื่อดูหรือแก้ยอดของเดือนนั้น</p>
      {!current ? (
        <div className="empty" role="status">
          {loading ? 'กำลังโหลด…' : <><p>โหลดประวัติรายการนี้ไม่สำเร็จ</p><button type="button" className="btn ghost" onClick={reload}>ลองโหลดอีกครั้ง</button></>}
        </div>
      ) : current.entries.length === 0 ? (
        <div className="empty">ยังไม่มีแผนรายเดือนของรายการนี้</div>
      ) : (
        <section className="list" aria-label="ยอดรายการนี้แต่ละเดือน">
          {current.entries.map((entry) => {
            const status = entryStatus(entry, item)
            const selected = entry.month === currentMonth
            return (
              <button
                key={entry.id}
                type="button"
                className="row"
                ref={selected ? currentRow : undefined}
                aria-current={selected ? 'date' : undefined}
                style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto', background: selected ? 'var(--cream)' : undefined }}
                onClick={() => onSelect(entry)}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span className="title" style={{ display: 'block' }}>{monthLabel(entry.month)}</span>
                  {selected && <span className="meta-t" style={{ display: 'block' }}>เดือนที่กำลังดู</span>}
                  <span className={`chip ${status}`} style={{ marginTop: 6 }}>{STATUS_LABEL[status]}</span>
                </span>
                <Money v={entry.amount} className="amt" />
                <ChevronRight size={16} className="muted" aria-hidden />
              </button>
            )
          })}
        </section>
      )}
    </Sheet>
  )
}
