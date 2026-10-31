import { useState } from 'react'
import { CalendarCheck, ChevronRight, CircleAlert, PiggyBank } from 'lucide-react'
import { budgetStatus } from '../../domain/budget'
import { formatBaht } from '../../domain/money'
import { bangkokToday, dateLabel, monthLabel, monthOf } from '../../domain/month'
import { needsClosing } from '../../domain/savings'
import type { Transaction } from '../../domain/types'
import { BudgetSheet } from '../components/BudgetSheet'
import { Money } from '../components/Money'
import { PageHeader } from '../components/PageHeader'
import { SavingsSheet } from '../components/SavingSheets'
import { SwipeRow } from '../components/SwipeRow'
import { TxEditSheet } from '../components/TxEditSheet'
import { TxRow } from '../components/TxRow'
import { loadMonth } from '../monthData'
import { useAction, useApp, useLoad } from '../store'
import { primeKeyboard } from '../viewport'

type Open = { kind: 'tx'; tx: Transaction } | { kind: 'budget' } | { kind: 'savings' } | null

export function Home({ onOpenPlan }: { onOpenPlan: (month?: string) => void }) {
  const { repo } = useApp()
  const { run } = useAction()
  const today = bangkokToday()
  const month = monthOf(today)
  const { data } = useLoad(() => loadMonth(repo, month), [month])
  const [open, setOpen] = useState<Open>(null)

  const hour = Number(new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 13))
  const greet = hour < 11 ? 'อรุณสวัสดิ์' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'
  const header = (
    <PageHeader
      eyebrow="01 — Available balance"
      title="เงินพร้อมใช้"
      sub={`${greet} · ${dateLabel(today)}`}
    />
  )
  if (!data) return <div className="page">{header}<div className="empty">กำลังโหลด…</div></div>

  const s = data.summary
  const spent = data.txs.reduce((a, t) => a + t.amount, 0) // ใช้ไปเดือนนี้ (ตามปฏิทิน)
  const b = budgetStatus(data.budget, spent, month, today)
  const cyc = data.spending // รอบที่ปิดยอดล่าสุด เริ่มใช้ได้ทันที
  const todayTxs = data.txs.filter((t) => t.date === today)
  const todayTotal = todayTxs.reduce((a, t) => a + t.amount, 0)
  const catById = new Map(data.categories.map((c) => [c.id, c]))
  const closing = needsClosing(today, data.records)
  const savedThisMonth = data.savings.reduce((a, x) => a + x.amount, 0)

  const removeTx = (t: Transaction) =>
    run(async () => {
      await repo.deleteTransaction(t.id)
      if (t.slipPath) await repo.deleteSlip(t.slipPath).catch((e) => console.warn('ลบรูปสลิปไม่สำเร็จ', e))
    }, 'ลบแล้ว', 'delete')

  return (
    <div className="page">
      {header}

      {closing && (
        <button className="notice closing" onClick={() => onOpenPlan(closing)}>
          <CalendarCheck size={20} strokeWidth={1.7} />
          <span>
            <b>ปิดยอด {monthLabel(closing)}</b>
            <span className="muted"> — จัดการต่อที่แผนเดือน</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.7} />
        </button>
      )}

      <section className="balance-hero" aria-label="ยอดเงินพร้อมใช้รอบปัจจุบัน">
        <div className="balance-label">เงินรอบนี้เหลือ</div>
        <div className={`balance-amount ${cyc && cyc.left < 0 ? 'neg' : 'goldtext'}`}>
          {cyc ? formatBaht(cyc.left) : '—'}<small>บาท</small>
        </div>
        {cyc ? (
          <>
            <div className="balance-meta">
              เริ่มรอบ {dateLabel(data.records.find((r) => r.month === cyc.month)?.closedAt
                ? bangkokToday(new Date(data.records.find((r) => r.month === cyc.month)!.closedAt!))
                : `${cyc.spendMonth}-01`)} · ยอดปิด {monthLabel(cyc.month)}
            </div>
            <div className="balance-details">
              <span>ตั้งต้น <b>{formatBaht(cyc.startMoney)}</b></span>
              <span>ใช้ไป <b>{formatBaht(cyc.daily)}</b></span>
              {cyc.savedDeposits > 0 && <span>แยกเก็บ <b>{formatBaht(cyc.savedDeposits)}</b></span>}
            </div>
            <button className="btn ghost" onClick={() => onOpenPlan(cyc.month)}>ดูที่มาของยอดเงิน <ChevronRight size={16} /></button>
          </>
        ) : (
          <>
            <p className="muted">รับเงินเดือนและจ่ายบิลแล้ว ปิดยอดเพื่อเริ่มใช้เงินรอบใหม่</p>
            <button className="btn primary" onClick={() => onOpenPlan()}>ไปแผนเดือนเพื่อปิดยอด</button>
          </>
        )}
      </section>

      <div className="boxes home-stats">
        <div className="box"><div className="l">วันนี้ใช้ไป</div><div className="v">{formatBaht(todayTotal)}</div></div>
        <div className="box"><div className="l">รายวันทั้ง {monthLabel(month)}</div><div className="v">{formatBaht(spent)}</div></div>
      </div>
      <button className="budget-summary" onClick={() => { primeKeyboard(); setOpen({ kind: 'budget' }) }}>
        <span>งบรายวันตามปฏิทิน</span>
        <b>{b ? `เหลือ ${formatBaht(b.left)} บาท` : 'ตั้งงบใช้จ่าย'}</b>
        <ChevronRight size={16} />
      </button>

      <button className="savings-card" onClick={() => setOpen({ kind: 'savings' })}>
        <span className="glyph holo"><PiggyBank size={22} strokeWidth={1.6} /></span>
        <div>
          <div className="l">เงินเก็บสะสม</div>
          <div className="v">{formatBaht(data.savingsTotal)}</div>
          <div className="s">{savedThisMonth > 0 ? <>เดือนนี้ <b>+{formatBaht(savedThisMonth)}</b></> : 'เดือนนี้ยังไม่ได้เก็บ'}</div>
        </div>
        <ChevronRight size={18} strokeWidth={1.7} className="muted" />
      </button>

      {(s.pendingEstimates > 0 || s.unpaid > 0) && (
        <button className="notice" onClick={() => onOpenPlan()}>
          <CircleAlert size={20} strokeWidth={1.7} />
          <span>
            {s.pendingEstimates > 0 && <>ยอดประมาณ {s.pendingEstimates} รายการ</>}
            {s.pendingEstimates > 0 && s.unpaid > 0 && ' · '}
            {s.unpaid > 0 && <>รอจ่าย {s.unpaid} รายการ</>}
            <span className="muted"> — แตะเพื่ออัปเดต</span>
          </span>
        </button>
      )}

      <div className="section">
        <div className="section-head">
          <h2>วันนี้</h2>
          {todayTxs.length > 0 && <Money v={-todayTotal} className="aside" />}
        </div>
        <div className="list">
          {todayTxs.length === 0 ? (
            <div className="empty">ยังไม่มีรายจ่ายวันนี้ แตะปุ่มทองด้านล่างเพื่อเพิ่ม</div>
          ) : (
            todayTxs.map((t) => (
              <SwipeRow key={t.id} onDelete={() => removeTx(t)}>
                <TxRow tx={t} cat={t.categoryId ? catById.get(t.categoryId) : undefined} onClick={() => setOpen({ kind: 'tx', tx: t })} />
              </SwipeRow>
            ))
          )}
        </div>
        {todayTxs.length > 0 && <p className="swipe-hint">ปัดรายการไปทางซ้ายเพื่อลบ</p>}
      </div>

      {open?.kind === 'tx' && <TxEditSheet tx={open.tx} categories={data.categories} onClose={() => setOpen(null)} />}
      {open?.kind === 'budget' && <BudgetSheet month={month} current={data.budget} onClose={() => setOpen(null)} />}
      {open?.kind === 'savings' && <SavingsSheet onClose={() => setOpen(null)} />}
    </div>
  )
}
