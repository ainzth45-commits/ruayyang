import { useState } from 'react'
import { ChevronDown, Download, LogOut, PiggyBank, Plus, RotateCcw } from 'lucide-react'
import { formatBaht, parseMoneyInput, sanitizeText } from '../../domain/money'
import { bangkokToday, monthLabel, monthOf } from '../../domain/month'
import { addItemToExistingMonths, applyDefaultToFuture, removeItem, stopItem } from '../../domain/plan'
import type { Category, ItemKind, RecurringItem } from '../../domain/types'
import { isLocalMode } from '../../data'
import { Money } from '../components/Money'
import { ConfirmButton, Sheet } from '../components/Sheet'
import { PageHeader } from '../components/PageHeader'
import { MonthField } from '../components/Pickers'
import { CATEGORY_ICONS, CategoryIcon } from '../icons'
import { useAction, useApp, useLoad } from '../store'
import { blurOnEnter, moneyInputProps, textInputProps } from '../inputs'
import { isSoundOn, play, setSoundOn } from '../sound'
import { primeKeyboard } from '../viewport'

export function Settings() {
  const { repo, auth, user, toast } = useApp()
  const { busy, run } = useAction()
  const cats = useLoad(() => repo.listCategories(), [])
  const items = useLoad(() => repo.listItems(), [])
  const settings = useLoad(() => repo.getSettings(), [])
  const [opening, setOpening] = useState(false)
  const [cat, setCat] = useState<Category | 'new' | null>(null)
  const [item, setItem] = useState<RecurringItem | 'new' | null>(null)
  const [exporting, setExporting] = useState(false)

  const doExport = async () => {
    setExporting(true)
    try {
      const { exportXlsx } = await import('../../export/exportXlsx')
      await exportXlsx(repo)
      play('save')
    } catch (e) {
      console.error(e)
      play('error')
      toast('Export ไม่สำเร็จ ลองใหม่อีกครั้ง', 'error')
    } finally {
      setExporting(false)
    }
  }

  const thisMonth = monthOf(bangkokToday())
  const visibleItems = (items.data ?? []).filter((i) => !i.archived)
  const isEnded = (i: RecurringItem) => i.endMonth !== null && i.endMonth < thisMonth
  const activeItems = visibleItems.filter((i) => !isEnded(i))
  const endedItems = visibleItems.filter(isEnded)
  const [showEnded, setShowEnded] = useState(false)
  const itemRow = (i: RecurringItem) => (
    <button key={i.id} className="row" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setItem(i)}>
      <span>
        <div className="title">{i.name}</div>
        <div className="meta-t">
          {i.kind === 'income' ? 'รายรับ' : 'รายจ่าย'}
          {i.isEstimate ? ' · ประมาณ' : ''}
          {i.endMonth ? ` · ${isEnded(i) ? 'จบ' : 'ถึง'} ${monthLabel(i.endMonth)}` : ''}
        </div>
      </span>
      <Money v={i.defaultAmount} className="amt" />
    </button>
  )

  return (
    <div className="page">
      <PageHeader eyebrow="04 — Settings" title="ตั้งค่า" sub={user.email} />

      <div className="section">
        <div className="section-head"><h2>หมวดรายจ่ายรายวัน</h2></div>
        <div className="list">
          {(cats.data ?? []).map((c) => (
            <button key={c.id} className="row" onClick={() => setCat(c)} style={{ opacity: c.archived ? 0.45 : 1 }}>
              <span className="glyph"><CategoryIcon name={c.icon} /></span>
              <span className="title">{c.name}</span>
              <span className="meta-t">{c.archived ? 'ซ่อนอยู่' : ''}</span>
            </button>
          ))}
        </div>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setCat('new')}><Plus size={18} strokeWidth={1.6} /> เพิ่มหมวด</button>
      </div>

      <div className="section">
        <div className="section-head"><h2>รายการประจำ</h2><span className="aside" style={{ fontSize: 12 }}>ใช้สร้างเดือนใหม่</span></div>
        <div className="list">
          {activeItems.length ? activeItems.map(itemRow) : <div className="empty">ยังไม่มีรายการประจำ</div>}
        </div>
        {endedItems.length > 0 && (
          <>
            <button className="fold-btn" aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>
              รายการที่จบแล้ว ({endedItems.length}) <ChevronDown size={16} strokeWidth={1.8} />
            </button>
            {showEnded && <div className="list ended">{endedItems.map(itemRow)}</div>}
          </>
        )}
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setItem('new')}><Plus size={18} strokeWidth={1.6} /> เพิ่มรายการประจำ</button>
      </div>

      <div className="section">
        <div className="section-head"><h2>เงินเก็บ</h2></div>
        <div className="list">
          <button className="row" onClick={() => { primeKeyboard(); setOpening(true) }}>
            <span className="glyph holo"><PiggyBank size={20} strokeWidth={1.6} /></span>
            <span>
              <div className="title">เงินเก็บตั้งต้น</div>
              <div className="meta-t">เงินเก็บที่มีอยู่ก่อนเริ่มใช้แอป</div>
            </span>
            <Money v={settings.data?.savingsOpening ?? 0} className="amt" />
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2>เสียง</h2></div>
        <SoundSwitch />
      </div>

      <div className="section">
        <div className="section-head"><h2>ข้อมูล</h2></div>
        <button className="btn ghost" onClick={doExport} disabled={exporting}>
          <Download size={18} strokeWidth={1.6} /> {exporting ? 'กำลังสร้างไฟล์…' : 'Export เป็น Excel (สำรองข้อมูล)'}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => run(() => auth.signOut())}>
          <LogOut size={18} strokeWidth={1.6} /> ออกจากระบบ
        </button>
        {import.meta.env.DEV && isLocalMode && ( // DEV ตรงๆ ให้ build ตัดโค้ด local ทิ้ง
          <button
            className="btn ghost"
            onClick={async () => {
              const { resetLocalData } = await import('../../data/localBackend')
              await resetLocalData()
              location.reload()
            }}
          >
            <RotateCcw size={18} strokeWidth={1.6} /> รีเซ็ตข้อมูลตัวอย่าง
          </button>
        )}
        <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 18 }}>
          รวยยัง? · {isLocalMode ? 'โหมดตัวอย่าง (เก็บในเครื่องนี้)' : 'เชื่อมต่อ Supabase'}
        </p>
      </div>

      {opening && settings.data && <OpeningSheet value={settings.data.savingsOpening} onClose={() => setOpening(false)} />}
      {cat && <CategorySheet cat={cat === 'new' ? null : cat} count={cats.data?.length ?? 0} onClose={() => setCat(null)} />}
      {item && <ItemSheet item={item === 'new' ? null : item} count={items.data?.length ?? 0} onClose={() => setItem(null)} />}
    </div>
  )
}

function CategorySheet({ cat, count, onClose }: { cat: Category | null; count: number; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [name, setName] = useState(cat?.name ?? '')
  const [icon, setIcon] = useState(cat?.icon ?? 'tag')
  const clean = sanitizeText(name, 40)
  const save = (archived: boolean) =>
    run(async () => {
      await repo.saveCategory({ id: cat?.id, name: clean, icon, sort: cat?.sort ?? count, archived })
      onClose()
    }, 'บันทึกหมวดแล้ว', 'save')
  return (
    <Sheet title={cat ? 'แก้ไขหมวด' : 'เพิ่มหมวด'} onClose={onClose}>
      <label className="field"><span>ชื่อหมวด</span><input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <div className="section-head"><h2>ไอคอน</h2></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 18 }}>
        {Object.keys(CATEGORY_ICONS).map((k) => (
          <button key={k} className="cat icon-only" aria-pressed={icon === k} aria-label={k} onClick={() => setIcon(k)}>
            <CategoryIcon name={k} size={18} />
          </button>
        ))}
      </div>
      <button className="btn primary" disabled={!clean || busy} onClick={() => save(cat?.archived ?? false)}>บันทึก</button>
      {cat && (
        <button className="btn ghost" disabled={busy} onClick={() => save(!cat.archived)}>
          {cat.archived ? 'เลิกซ่อนหมวดนี้' : 'ซ่อนหมวดนี้ (ประวัติยังอยู่)'}
        </button>
      )}
    </Sheet>
  )
}

function ItemSheet({ item, count, onClose }: { item: RecurringItem | null; count: number; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const thisMonth = monthOf(bangkokToday())
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'expense')
  const [amount, setAmount] = useState(item ? formatBaht(item.defaultAmount) : '')
  const [estimate, setEstimate] = useState(item?.isEstimate ?? false)
  const [start, setStart] = useState(item?.startMonth ?? thisMonth)
  const [end, setEnd] = useState(item?.endMonth ?? '')
  const [applyFuture, setApplyFuture] = useState(true)
  const p = parseMoneyInput(amount, { allowZero: true })
  const clean = sanitizeText(name, 80)
  const monthOk = /^\d{4}-\d{2}$/.test(start) && (end === '' || (/^\d{4}-\d{2}$/.test(end) && end >= start))
  const amountChanged = item !== null && p.ok && p.value !== item.defaultAmount

  const save = () =>
    p.ok &&
    run(async () => {
      const base = { name: clean, kind, isEstimate: estimate, startMonth: start, endMonth: end || null, sort: item?.sort ?? count, archived: false }
      if (item && amountChanged && applyFuture) {
        await applyDefaultToFuture(repo, { ...item, ...base }, p.value, thisMonth)
      } else {
        const saved = await repo.saveItem({ id: item?.id, ...base, defaultAmount: p.value })
        if (!item) await addItemToExistingMonths(repo, saved) // รายการใหม่ → ลงเดือนที่เปิดไว้แล้วด้วย
      }
      onClose()
    }, 'บันทึกแล้ว', 'save')

  return (
    <Sheet title={item ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'} onClose={onClose}>
      <div className="seg">
        <button aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>รายจ่าย</button>
        <button aria-pressed={kind === 'income'} onClick={() => setKind('income')}>รายรับ</button>
      </div>
      <label className="field"><span>ชื่อรายการ</span><input className="input" {...textInputProps} onKeyDown={blurOnEnter} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field">
        <span>ยอดตั้งต้นต่อเดือน (บาท)</span>
        <input className={`input num ${p.ok || amount === '' ? '' : 'err'}`} {...moneyInputProps} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </label>
      {amountChanged && (
        <div className="switch">
          <span style={{ fontSize: 14 }}>ใช้ยอดใหม่กับเดือนที่ยังไม่จ่าย<br /><span className="muted" style={{ fontSize: 12 }}>ตั้งแต่ {monthLabel(thisMonth)} เป็นต้นไป</span></span>
          <button className="toggle" role="switch" aria-checked={applyFuture} onClick={() => setApplyFuture(!applyFuture)} />
        </div>
      )}
      <div className="switch" style={{ marginBottom: 14 }}>
        <span>ยอดประมาณ (ยังไม่แน่นอน)</span>
        <button className="toggle" role="switch" aria-checked={estimate} onClick={() => setEstimate(!estimate)} />
      </div>
      <div className="two">
        <MonthField label="เดือนเริ่ม" value={start} onChange={(m) => m && setStart(m)} />
        <MonthField label="เดือนสุดท้าย" value={end} onChange={setEnd} emptyLabel="ไม่มีกำหนด" min={start} invalid={!monthOk} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>{item ? 'แก้ยอด/ช่วงเดือนแล้ว เดือนที่มีอยู่ไม่เปลี่ยนตาม — แก้รายเดือนได้ในหน้าแผนเดือน' : 'รายการใหม่จะลงทุกเดือนตั้งแต่เดือนเริ่ม (รวมเดือนที่มีอยู่แล้ว)'}</p>
      <button className="btn primary" disabled={!clean || !p.ok || !monthOk || busy} onClick={save}>บันทึก</button>
      {item && (
        <div className="item-actions">
          {!(item.endMonth !== null && item.endMonth < thisMonth) && (
            <ConfirmButton
              label={`เลิกรายการนี้ตั้งแต่ ${monthLabel(thisMonth)}`}
              confirmLabel="แตะอีกครั้งเพื่อยืนยัน (ย้ายไปรายการที่จบแล้ว)"
              disabled={busy}
              onConfirm={() =>
                run(async () => {
                  await stopItem(repo, item, thisMonth)
                  onClose()
                }, 'เลิกรายการแล้ว', 'delete')
              }
            />
          )}
          <ConfirmButton
            label="ลบรายการนี้"
            confirmLabel="แตะอีกครั้งเพื่อลบ (เดือนที่จ่ายแล้วเก็บเป็นประวัติ)"
            disabled={busy}
            onConfirm={() =>
              run(async () => {
                await removeItem(repo, item, thisMonth)
                onClose()
              }, `ลบ ${item.name} แล้ว`, 'delete')
            }
          />
          <p className="muted" style={{ fontSize: 12, margin: '2px 4px 0' }}>
            ทั้งสองแบบ: เดือน {monthLabel(thisMonth)} เป็นต้นไปที่ยังไม่จ่ายจะหายไป · เดือนก่อนหน้าไม่เปลี่ยน
          </p>
        </div>
      )}
    </Sheet>
  )
}

function OpeningSheet({ value, onClose }: { value: number; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [text, setText] = useState(formatBaht(value))
  const p = parseMoneyInput(text, { allowZero: true })
  const save = () =>
    p.ok &&
    run(async () => {
      await repo.saveSettings({ savingsOpening: p.value })
      onClose()
    }, 'บันทึกเงินเก็บตั้งต้นแล้ว', 'save')
  return (
    <Sheet title="เงินเก็บตั้งต้น" onClose={onClose}>
      <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 13.5 }}>เงินเก็บที่มีอยู่แล้วก่อนเริ่มใช้แอป — รวมกับที่เก็บในแอปเป็นเงินเก็บสะสม</p>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className={`amount-box holo ${p.ok ? '' : 'err'}`}>
          <label htmlFor="opening-amount">ยอด (บาท)</label>
          <div className="amount-row">
            <span className="cur">฿</span>
            <input id="opening-amount" className="amount-input" {...moneyInputProps} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        {!p.ok && <div className="err-text" style={{ marginTop: -10, marginBottom: 12 }}>{p.error}</div>}
        <button className="btn primary" type="submit" disabled={!p.ok || busy}>บันทึก</button>
      </form>
    </Sheet>
  )
}

function SoundSwitch() {
  const [on, setOn] = useState(isSoundOn)
  return (
    <div className="switch">
      <span>เสียงในแอป<br /><span className="muted" style={{ fontSize: 12 }}>เสียงเหรียญตอนบันทึก · ปิดตามสวิตช์เงียบของ iPhone</span></span>
      <button
        className="toggle"
        role="switch"
        aria-checked={on}
        aria-label="เสียงในแอป"
        onClick={() => {
          setSoundOn(!on)
          setOn(!on)
          if (!on) play('coin')
        }}
      />
    </div>
  )
}
