import { useState } from 'react'
import { categoryBreakdown, dailyTotals } from '../../domain/calc'
import { formatBaht } from '../../domain/money'
import { bangkokToday, dateLabel, daysInMonth, monthOf, WEEKDAYS_SHORT } from '../../domain/month'
import type { MonthKey, Transaction } from '../../domain/types'
import { Money } from '../components/Money'
import { FixedCalendar } from '../components/FixedCalendar'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { PageHeader } from '../components/PageHeader'
import { TxEditSheet } from '../components/TxEditSheet'
import { SwipeRow } from '../components/SwipeRow'
import { TxRow } from '../components/TxRow'
import { CategoryIcon } from '../icons'
import { loadMonth } from '../monthData'
import { useAction, useApp, useLoad } from '../store'

export function Daily() {
  const { repo } = useApp()
  const { run } = useAction()
  const today = bangkokToday()
  const [month, setMonth] = useState<MonthKey>(monthOf(today))
  const [selected, setSelected] = useState<string | null>(today)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [mode, setMode] = useState<'daily' | 'fixed'>('daily')
  const { data, loading, reload } = useLoad(() => loadMonth(repo, month), [month])
  const current = data?.month === month ? data : null

  const changeMonth = (m: MonthKey) => {
    setMonth(m)
    setSelected(m === monthOf(today) ? today : null)
  }

  const txs = current?.txs ?? []
  const totals = dailyTotals(txs)
  const max = Math.max(1, ...totals.values())
  const [y, m] = month.split('-').map(Number)
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = daysInMonth(month)
  const catById = new Map((current?.categories ?? []).map((c) => [c.id, c]))
  const dayTxs = selected ? txs.filter((t) => t.date === selected) : txs
  const breakdown = categoryBreakdown(txs)
  const total = txs.reduce((a, t) => a + t.amount, 0)

  return (
    <div className="page">
      <PageHeader eyebrow="02 — Calendar" title="ปฏิทิน" sub={mode === 'daily' ? 'ใช้จ่ายวันไหน เท่าไร' : 'บิลและหลักฐานจ่ายประจำแต่ละเดือน'} right={<MonthSwitcher month={month} onChange={changeMonth} />} />
      <div className="calendar-modes" role="group" aria-label="ประเภทค่าใช้จ่าย">
        <button type="button" aria-pressed={mode === 'daily'} onClick={() => setMode('daily')}>ใช้จ่ายรายวัน</button>
        <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>จ่ายประจำ</button>
      </div>
      {!current ? <div className="empty" role="status">
        {loading ? 'กำลังโหลด…' : <><p>โหลดข้อมูลไม่สำเร็จ</p><button type="button" className="btn ghost" onClick={reload}>ลองใหม่</button></>}
      </div> : mode === 'fixed' ? (
        <FixedCalendar key={month} month={month} entries={current.entries} items={current.items} />
      ) : <>
      <section className="boxes" aria-label="สรุปใช้จ่ายรายวัน" style={{ marginBottom: 16 }}>
        <div className="box"><div className="l">ใช้ไปทั้งเดือน</div><div className="v gold">{formatBaht(total)}</div></div>
        <div className="box">
          <div className="l">ยอดวันที่ดู</div>
          <div className="v">{selected ? formatBaht(totals.get(selected) ?? 0) : '—'}</div>
          <div className="s">{selected ? dateLabel(selected) : 'แตะเลือกวันในปฏิทิน'}</div>
        </div>
      </section>

      <div className="cal" role="grid" aria-label="ปฏิทินรายจ่าย">
        {WEEKDAYS_SHORT.map((w) => <div key={w} className="wd">{w}</div>)}
        {Array.from({ length: firstWd }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, '0')}`
          const v = totals.get(d) ?? 0
          return (
            <button
              key={d}
              className={`day ${d === today ? 'today' : ''}`}
              aria-pressed={selected === d}
              aria-label={`${dateLabel(d)} ${formatBaht(v)} บาท`}
              onClick={() => setSelected(selected === d ? null : d)}
            >
              {v > 0 && <i className="heat" style={{ opacity: 0.08 + 0.32 * (v / max) }} />}
              <span className="d">{i + 1}</span>
              {v > 0 && <span className="s">{v >= 100_000 ? `${(v / 100_000).toFixed(1)}k` : formatBaht(v, { decimals: false })}</span>}
            </button>
          )
        })}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>{selected ? dateLabel(selected) : 'ทั้งเดือน'}</h2>
          {dayTxs.length > 0 && <Money v={-dayTxs.reduce((a, t) => a + t.amount, 0)} className="aside" />}
        </div>
        <div className="list">
          {dayTxs.length === 0 ? (
            <div className="empty">ไม่มีรายจ่าย</div>
          ) : (
            dayTxs.map((t) => (
              <SwipeRow
                key={t.id}
                onDelete={() =>
                  run(async () => {
                    await repo.deleteTransaction(t.id)
                    if (t.slipPath) await repo.deleteSlip(t.slipPath).catch((e) => console.warn('ลบรูปสลิปไม่สำเร็จ', e))
                  }, 'ลบแล้ว', 'delete')
                }
              >
                <TxRow tx={t} cat={t.categoryId ? catById.get(t.categoryId) : undefined} meta={selected ? undefined : dateLabel(t.date)} onClick={() => setEditing(t)} />
              </SwipeRow>
            ))
          )}
        </div>
      </div>

      {breakdown.length > 0 && (
        <div className="section">
          <div className="section-head"><h2>ตามหมวด</h2></div>
          <div className="list" style={{ padding: '6px 16px' }}>
          {breakdown.map((b) => {
            const c = b.categoryId ? catById.get(b.categoryId) : undefined
            return (
              <div key={b.categoryId ?? 'none'} style={{ padding: '12px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="glyph" style={{ width: 32, height: 32, borderRadius: 10 }}><CategoryIcon name={c?.icon} size={16} /></span>
                  <span style={{ flex: 1, fontSize: 14 }}>{c?.name ?? 'ไม่ระบุหมวด'}</span>
                  <span className="num muted" style={{ fontSize: 12 }}>{Math.round(b.share * 100)}%</span>
                  <span className="num" style={{ minWidth: 84, textAlign: 'right', fontWeight: 500 }}>{formatBaht(b.total)}</span>
                </div>
                <div className="bar"><i style={{ width: `${b.share * 100}%` }} /></div>
              </div>
            )
          })}
          </div>
        </div>
      )}
      </>}

      {editing && <TxEditSheet tx={editing} categories={current?.categories ?? []} onClose={() => setEditing(null)} />}
    </div>
  )
}
