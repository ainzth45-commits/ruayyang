import { useEffect, useState } from 'react'
import { CalendarCheck, Plus, TableProperties } from 'lucide-react'
import { entryStatus, summarizeMonth } from '../../domain/calc'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import { addMonths, bangkokToday, monthEndDate, monthLabel, monthOf, monthStartDate } from '../../domain/month'
import { addItemToExistingMonths, ensureMonths } from '../../domain/plan'
import { isMonthClosed } from '../../domain/savings'
import type { ItemKind, MonthEntry, MonthKey, RecurringItem } from '../../domain/types'
import { Money } from '../components/Money'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { PageHeader } from '../components/PageHeader'
import { EntrySheet } from '../components/EntrySheet'
import { CloseMonthSheet } from '../components/CloseMonthSheet'
import { Sheet } from '../components/Sheet'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { loadMonth } from '../monthData'
import { useAction, useApp, useLoad } from '../store'

const STATUS_LABEL = { paid: 'จ่ายแล้ว', estimate: 'ประมาณ', pending: 'รอจ่าย' } as const

export function Plan({ month, onMonth }: { month: MonthKey; onMonth: (m: MonthKey) => void }) {
  const { repo } = useApp()
  const { data, loading, reload } = useLoad(() => loadMonth(repo, month), [month])
  const [editing, setEditing] = useState<MonthEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [year, setYear] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    setEditing(null)
    setAdding(false)
    setYear(false)
    setClosing(false)
  }, [month])

  const header = <PageHeader eyebrow="03 — Monthly plan" title="แผนเดือน" sub={`${monthLabel(month, { long: true })} · รับเงิน จ่ายบิล แล้วเริ่มรอบใหม่`} right={<MonthSwitcher month={month} onChange={onMonth} />} />
  if (!data || data.month !== month) return <div className="page">{header}<div className="empty" role="status">
    {loading ? 'กำลังโหลด…' : <><p>โหลดข้อมูลไม่สำเร็จ</p><button type="button" className="btn ghost" onClick={reload}>ลองใหม่</button></>}
  </div></div>
  const s = data.summary
  const itemById = new Map(data.items.map((i) => [i.id, i]))
  const sorted = [...data.entries].sort((a, b) => (itemById.get(a.itemId)?.sort ?? 999) - (itemById.get(b.itemId)?.sort ?? 999))
  const incomes = sorted.filter((e) => itemById.get(e.itemId)?.kind === 'income')
  const expenses = sorted.filter((e) => itemById.get(e.itemId)?.kind !== 'income')

  const row = (e: MonthEntry) => {
    const it = itemById.get(e.itemId)
    const st = entryStatus(e, it)
    return (
      <button key={e.id} className="row" style={{ gridTemplateColumns: '1fr auto auto' }} onClick={() => setEditing(e)}>
        <span>
          <div className="title">{it?.name ?? 'รายการที่ถูกลบ'}</div>
          {e.note && <div className="meta-t">{e.note}</div>}
          {e.receiptPath && <div className="meta-t">มีหลักฐานชำระ</div>}
        </span>
        {it?.kind === 'income' ? <span /> : <span className={`chip ${st}`}>{STATUS_LABEL[st]}</span>}
        <Money v={e.amount} className="amt" />
      </button>
    )
  }

  return (
    <div className="page">
      {header}

      <div className="boxes" style={{ marginBottom: 12 }}>
        <div className="box"><div className="l">แผนเหลือไว้ใช้ {monthLabel(s.spendMonth)}</div><div className={`v ${s.planLeft < 0 ? 'neg' : 'gold'}`}>{formatBaht(s.planLeft)}</div><div className="s">รับ − จ่ายประจำ</div></div>
        <div className="box"><div className="l">เงินเกินแผน</div><div className={`v ${s.diff === null ? '' : s.diff >= 0 ? 'pos' : 'neg'}`}>{s.diff === null ? '—' : `${s.diff > 0 ? '+' : ''}${formatBaht(s.diff)}`}</div><div className="s">{s.diff === null ? 'รู้ผลตอนปิดเดือน' : 'คงเหลือจริง − แผนเหลือ'}</div></div>
      </div>

      <div className="panel" style={{ padding: '8px 20px' }}>
        <div className="ledger-line"><span>รายรับ</span><Money v={s.income} /></div>
        <div className="ledger-line"><span>จ่ายประจำ</span><Money v={-s.fixedExpense} /></div>
        <div className="ledger-line total"><span>แผนเหลือไว้ใช้ {monthLabel(s.spendMonth)}</span><Money v={s.planLeft} className={s.planLeft < 0 ? 'neg' : ''} /></div>
        {/* key: รีเซ็ต state เมื่อเปลี่ยนเดือน/ค่าเปลี่ยน กันยอดเดือนก่อนค้างไปบันทึกทับเดือนใหม่ */}
        <div className="ledger-line"><span>ยอดปิดจริง</span><span>{s.actualBalance === null ? 'ยังไม่ปิดยอด' : formatBaht(s.actualBalance)}</span></div>
        {s.savedAtClose > 0 && <div className="ledger-line"><span>แยกเก็บตอนปิดเดือน</span><Money v={-s.savedAtClose} /></div>}
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2>เงินรอบที่เริ่มจากยอดปิด {monthLabel(month)}</h2></div>
      <div className="panel cycle" style={{ padding: '8px 20px' }}>
        <div className="ledger-line"><span>เงินตั้งต้น{s.actualBalance === null ? ' (ตามแผน)' : ''}</span><Money v={s.startMoney} /></div>
        <div className="ledger-line"><span>ใช้รายวัน</span><Money v={-s.daily} /></div>
        {s.savedDeposits > 0 && <div className="ledger-line"><span>เก็บระหว่างเดือน</span><Money v={-s.savedDeposits} /></div>}
        <div className="ledger-line total"><span>เงินรอบนี้เหลือ</span><Money v={s.left} className={s.left < 0 ? 'neg' : 'pos'} /></div>
      </div>

      <button className="btn primary" style={{ marginTop: 12 }} disabled={month > monthOf(bangkokToday())} onClick={() => setClosing(true)}>
        <CalendarCheck size={18} strokeWidth={1.8} /> {isMonthClosed(data.record ?? undefined) ? 'แก้ยอดปิดรอบนี้' : 'ปิดยอดและเริ่มรอบใหม่'}
      </button>

      <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setYear(true)}>
        <TableProperties size={18} strokeWidth={1.6} /> ภาพรวมทุกเดือน
      </button>

      <div className="section">
        <div className="section-head"><h2>รายรับ</h2><Money v={s.income} className="aside" /></div>
        <div className="list">{incomes.length ? incomes.map(row) : <div className="empty">ไม่มีรายรับ</div>}</div>
      </div>
      <div className="section">
        <div className="section-head"><h2>จ่ายประจำ</h2><Money v={s.fixedExpense} className="aside" /></div>
        <div className="list">{expenses.length ? expenses.map(row) : <div className="empty">ไม่มีรายจ่ายประจำ</div>}</div>
      </div>
      <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setAdding(true)}>
        <Plus size={18} strokeWidth={1.6} /> เพิ่มรายการในเดือนนี้
      </button>

      {editing && <EntrySheet key={editing.id} entry={editing} item={itemById.get(editing.itemId)} onClose={() => setEditing(null)} />}
      {adding && <AddEntrySheet month={month} items={data.items} existing={data.entries} onClose={() => setAdding(false)} />}
      {closing && <CloseMonthSheet month={month} onClose={() => setClosing(false)} />}
      {year && <YearSheet current={month} onPick={(m) => { onMonth(m); setYear(false) }} onClose={() => setYear(false)} />}
    </div>
  )
}

function AddEntrySheet(props: { month: MonthKey; items: RecurringItem[]; existing: MonthEntry[]; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const used = new Set(props.existing.map((e) => e.itemId))
  const available = props.items.filter((i) => !used.has(i.id) && !i.archived)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ItemKind>('expense')
  const [amount, setAmount] = useState('')
  const [estimate, setEstimate] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const p = parseMoneyInput(amount, { allowZero: true })
  const cleanName = sanitizeText(name, 80)

  const addExisting = (it: RecurringItem) =>
    run(async () => {
      await repo.insertEntriesIfAbsent([{ itemId: it.id, month: props.month, amount: it.defaultAmount, paid: false, note: null }])
      props.onClose()
    }, `เพิ่ม ${it.name} แล้ว`, 'save')

  const addNew = () =>
    p.ok &&
    cleanName &&
    run(async () => {
      const it = await repo.saveItem({
        name: cleanName, kind, defaultAmount: p.value, isEstimate: estimate,
        startMonth: props.month, endMonth: repeat ? null : props.month, sort: props.items.length, archived: false,
      })
      await repo.insertEntriesIfAbsent([{ itemId: it.id, month: props.month, amount: p.value, paid: false, note: null }])
      if (repeat) await addItemToExistingMonths(repo, it) // ทำซ้ำ → ลงเดือนถัดไปที่เปิดไว้แล้วด้วย
      props.onClose()
    }, `เพิ่ม ${cleanName} แล้ว`, 'save')

  return (
    <Sheet title={`เพิ่มรายการ ${monthLabel(props.month)}`} onClose={props.onClose}>
      {available.length > 0 && (
        <>
          <div className="section-head"><h2>จากรายการประจำ</h2></div>
          <div className="list" style={{ marginBottom: 20 }}>
            {available.map((it) => (
              <button key={it.id} className="row" style={{ gridTemplateColumns: '1fr auto' }} disabled={busy} onClick={() => addExisting(it)}>
                <span className="title">{it.name}</span>
                <Money v={it.defaultAmount} className="amt" />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-head"><h2>รายการใหม่</h2></div>
      <div className="seg">
        <button aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>รายจ่าย</button>
        <button aria-pressed={kind === 'income'} onClick={() => setKind('income')}>รายรับ</button>
      </div>
      <label className="field"><span>ชื่อรายการ</span><input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="เช่น ค่าประกันรถ" /></label>
      <label className="field"><span>ยอด (บาท)</span><input className="input num" {...moneyInputProps} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
      <div className="switch"><span>ยอดประมาณ (ยังไม่แน่นอน)</span><button className="toggle" role="switch" aria-checked={estimate} onClick={() => setEstimate(!estimate)} /></div>
      <div className="switch" style={{ marginBottom: 16 }}><span>ทำซ้ำทุกเดือนจากนี้ไป</span><button className="toggle" role="switch" aria-checked={repeat} onClick={() => setRepeat(!repeat)} /></div>
      <button className="btn primary" disabled={!p.ok || !cleanName || busy} onClick={addNew}>เพิ่มรายการ</button>
    </Sheet>
  )
}

function YearSheet({ current, onPick, onClose }: { current: MonthKey; onPick: (m: MonthKey) => void; onClose: () => void }) {
  const { repo } = useApp()
  const thisMonth = monthOf(bangkokToday())
  const { data } = useLoad(async () => {
    const all = await repo.listMonths('2000-01', '9999-12')
    const first = all[0]?.month ?? thisMonth
    const last = [all.at(-1)?.month ?? thisMonth, addMonths(thisMonth, 11)].sort().at(-1)!
    await ensureMonths(repo, first, last)
    const [items, entries, records, txs] = await Promise.all([
      repo.listItems(),
      repo.listEntries(first, last),
      repo.listMonths(first, last),
      repo.listTransactions(monthStartDate(first), monthEndDate(last)),
    ])
    const savings = await repo.listSavings(monthStartDate(first), monthEndDate(last))
    return records.map((r) => summarizeMonth(r.month, items, entries, txs, r, savings, records))
  }, [])
  return (
    <Sheet title="ภาพรวมทุกเดือน" onClose={onClose}>
      {!data ? (
        <div className="empty">กำลังคำนวณ…</div>
      ) : (
        <table className="ytable">
          <thead><tr><th>รอบ</th><th>แผนเหลือ</th><th>คงเหลือจริง</th><th>เกินแผน</th><th>เก็บ</th></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.month} className={s.month === current ? 'current' : ''} onClick={() => onPick(s.month)}>
                <td style={{ fontFamily: 'var(--font)' }}>{monthLabel(s.month)}</td>
                <td className={s.planLeft < 0 ? 'neg' : ''}>{formatBaht(s.planLeft)}</td>
                <td>{s.actualBalance === null ? '—' : formatBaht(s.actualBalance)}</td>
                <td className={s.diff === null ? 'muted' : s.diff >= 0 ? 'pos' : 'neg'}>{s.diff === null ? '—' : formatBaht(s.diff)}</td>
                <td className={s.savedAtClose > 0 ? 'pos' : 'muted'}>{s.savedAtClose > 0 ? formatBaht(s.savedAtClose, { decimals: false }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  )
}
