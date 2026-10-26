import { useId, useState } from 'react'
import { CalendarCheck, ChevronRight, CircleAlert, PiggyBank } from 'lucide-react'
import { budgetStatus } from '../../domain/budget'
import { formatBaht } from '../../domain/money'
import { bangkokToday, monthLabel, monthOf } from '../../domain/month'
import { needsClosing } from '../../domain/savings'
import type { Satang, Transaction } from '../../domain/types'
import { BudgetSheet } from '../components/BudgetSheet'
import { CloseMonthSheet } from '../components/CloseMonthSheet'
import { Money } from '../components/Money'
import { PageHeader } from '../components/PageHeader'
import { SavingsSheet } from '../components/SavingSheets'
import { SwipeRow } from '../components/SwipeRow'
import { TxEditSheet } from '../components/TxEditSheet'
import { TxRow } from '../components/TxRow'
import { loadMonth } from '../monthData'
import { useAction, useApp, useLoad } from '../store'
import { primeKeyboard } from '../viewport'

type Open = { kind: 'tx'; tx: Transaction } | { kind: 'budget' } | { kind: 'savings' } | { kind: 'close'; month: string } | null

export function Home({ onOpenPlan }: { onOpenPlan: () => void }) {
  const { repo } = useApp()
  const { run } = useAction()
  const today = bangkokToday()
  const month = monthOf(today)
  const { data } = useLoad(() => loadMonth(repo, month), [month])
  const [open, setOpen] = useState<Open>(null)

  const [y, mo] = month.split('-')
  const hour = Number(new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 13))
  const greet = hour < 11 ? 'อรุณสวัสดิ์' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'
  const header = (
    <PageHeader
      eyebrow="01 — This month"
      title={<>{monthLabel(month, { long: true }).split(' ')[0]} <span className="goldtext">{y}</span></>}
      sub={`${greet} · ข้อมูลเดือนนี้`}
    />
  )
  if (!data) return <div className="page">{header}<div className="empty">กำลังโหลด…</div></div>

  const s = data.summary
  const b = budgetStatus(data.budget, s.daily, month, today)
  const todayTxs = data.txs.filter((t) => t.date === today)
  const todayTotal = todayTxs.reduce((a, t) => a + t.amount, 0)
  const catById = new Map(data.categories.map((c) => [c.id, c]))
  const closing = needsClosing(today, data.records)
  const savedThisMonth = s.savedDeposits + s.savedAtClose

  const removeTx = (t: Transaction) =>
    run(async () => {
      await repo.deleteTransaction(t.id)
      if (t.slipPath) await repo.deleteSlip(t.slipPath).catch((e) => console.warn('ลบรูปสลิปไม่สำเร็จ', e))
    }, 'ลบแล้ว', 'delete')

  return (
    <div className="page">
      {header}

      {closing && (
        <button className="notice closing" onClick={() => setOpen({ kind: 'close', month: closing })}>
          <CalendarCheck size={20} strokeWidth={1.7} />
          <span>
            <b>ปิดเดือน {monthLabel(closing)}</b>
            <span className="muted"> — จ่ายประจำให้ครบ ใส่คงเหลือ แล้วแยกเก็บ</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.7} />
        </button>
      )}

      <section className="panel hero" aria-label={`งบใช้จ่ายเดือน ${mo}`}>
        <button className="gauge-btn" onClick={() => { primeKeyboard(); setOpen({ kind: 'budget' }) }} aria-label="ตั้งงบใช้จ่าย">
          <Gauge frac={b?.frac ?? 0} left={b?.left ?? null} />
        </button>
        <div className="meta-row">
          {!b ? (
            <button className="meta set" onClick={() => { primeKeyboard(); setOpen({ kind: 'budget' }) }}>ตั้งงบใช้จ่ายเดือนนี้</button>
          ) : b.left > 0 ? (
            <>
              <span className="meta">วันละ ~<b>{formatBaht(b.perDay, { decimals: false })}</b></span>
              <span className="meta">เหลือ <b>{b.daysLeft}</b> วัน</span>
            </>
          ) : (
            <span className="meta over">ใช้เกินงบ {formatBaht(-b.left, { decimals: false })} บาท</span>
          )}
        </div>
        <div className="boxes" style={{ textAlign: 'left' }}>
          <div className="box">
            <div className="l">วันนี้ใช้ไป</div>
            <div className="v gold">{formatBaht(todayTotal)}</div>
          </div>
          <div className="box">
            <div className="l">ใช้ไปทั้งเดือน</div>
            <div className="v">{formatBaht(s.daily)}</div>
            {data.budget !== null && <div className="s">จากงบ {formatBaht(data.budget, { decimals: false })}</div>}
          </div>
        </div>
      </section>

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
        <button className="notice" onClick={onOpenPlan}>
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
      {open?.kind === 'close' && <CloseMonthSheet month={open.month} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** วงแหวนงบเดือนนี้: ส่วนที่เหลือ = เส้นทองไล่ไปเขียวน้ำทะเล */
function Gauge({ frac, left }: { frac: number; left: Satang | null }) {
  const id = useId()
  const R = 104
  const C = 2 * Math.PI * R
  const angle = -Math.PI / 2 + frac * 2 * Math.PI
  const dot = { x: 118 + R * Math.cos(angle), y: 118 + R * Math.sin(angle) }
  return (
    <div className="gauge">
      <svg viewBox="0 0 236 236" width="236" height="236" aria-hidden>
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ecd29b" />
            <stop offset=".5" stopColor="#c79b4c" />
            <stop offset="1" stopColor="#0f7f8f" />
          </linearGradient>
          <radialGradient id={`${id}h`}>
            <stop offset="0" stopColor="#e3c68a" stopOpacity=".28" />
            <stop offset="1" stopColor="#e3c68a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="118" cy="118" r="88" fill={`url(#${id}h)`} />
        <circle cx="118" cy="118" r={R} fill="none" stroke="#ecebe7" strokeWidth="8" />
        <circle cx="118" cy="118" r="90" fill="none" stroke="#c79b4c" strokeOpacity=".4" strokeWidth="1.2" strokeDasharray="2 6" />
        {frac > 0 && (
          <>
            <circle
              className="arc"
              cx="118" cy="118" r={R} fill="none" stroke={`url(#${id}g)`} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 118 118)"
            />
            <circle cx={dot.x} cy={dot.y} r="7" fill="#fff" stroke="#0f7f8f" strokeWidth="3" />
          </>
        )}
      </svg>
      <div className="gauge-c">
        <div className="eyebrow" style={{ letterSpacing: '.32em' }}>Available</div>
        {left === null ? (
          <div className="amt dim">—</div>
        ) : (
          <div className={`amt ${left < 0 ? 'neg' : 'goldtext'}`}>{formatBaht(left)}</div>
        )}
        <div className="unit"><b>THB</b>{left === null ? 'ยังไม่ได้ตั้งงบ' : 'เหลือใช้ได้'}</div>
      </div>
    </div>
  )
}
