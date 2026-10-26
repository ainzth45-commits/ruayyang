import { useEffect, useRef, useState } from 'react'
import { Repeat2, ScanLine } from 'lucide-react'
import { formatBaht } from '../../domain/money'
import { addDays, bangkokToday, dateLabel, monthOf } from '../../domain/month'
import { orderCategories, repeatSuggestions, type RepeatPick } from '../../domain/repeat'
import type { DateKey, Satang, Transaction } from '../../domain/types'
import { CategoryIcon } from '../icons'
import { compressImage, sha256Hex } from '../../ocr/image'
import { readSlipAmount, warmUpOcr } from '../../ocr/ocr'
import { play } from '../sound'
import { useAction, useApp, useLoad } from '../store'
import { SavingForm, type SavingValues } from './SavingSheets'
import { Sheet } from './Sheet'
import { TxForm, type TxValues } from './TxForm'
import { primeKeyboard } from '../viewport'

interface SlipState {
  file: File
  url: string
  hash: string | null
  dup: Transaction | null
  scanning: boolean
  progress: number
  ocrAmount: Satang | null
  ocrDate: DateKey | null
}

export function AddSheet({ onClose }: { onClose: () => void }) {
  const { repo, toast, bump } = useApp()
  const { busy, run } = useAction()
  const today = bangkokToday()
  const base = useLoad(async () => {
    const [categories, recent] = await Promise.all([repo.listCategories(), repo.listTransactions(addDays(today, -60), today)])
    return { categories, recent }
  }, [today])
  const [kind, setKind] = useState<'expense' | 'saving'>('expense')
  const [mode, setMode] = useState<'manual' | 'slip'>('manual')
  const [picked, setPicked] = useState<File | null>(null)
  const [zoom, setZoom] = useState(false)
  const [slip, setSlip] = useState<SlipState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // อ่านสลิป: hash → เช็กซ้ำ → OCR (ยอด + วันที่)
  useEffect(() => {
    if (mode !== 'slip' || !picked) return
    const file = picked
    const url = URL.createObjectURL(file)
    let alive = true
    setSlip({ file, url, hash: null, dup: null, scanning: true, progress: 0, ocrAmount: null, ocrDate: null })
    ;(async () => {
      let hash: string | null = null
      let dup: Transaction | null = null
      try {
        hash = await sha256Hex(file)
        dup = await repo.findTransactionBySlipHash(hash)
      } catch (e) {
        console.warn('ตรวจสลิปซ้ำไม่ได้', e)
      }
      if (!alive) return
      if (dup) play('warn')
      setSlip((s) => s && { ...s, hash, dup })
      const r = await readSlipAmount(file, (p) => alive && setSlip((s) => s && { ...s, progress: p }))
      if (!alive) return
      setSlip((s) => s && { ...s, scanning: false, progress: 1, ocrAmount: r.amount, ocrDate: r.date })
      if (r.amount === null) {
        play('warn')
        toast('อ่านยอดไม่ได้ กรอกเองได้เลย')
      } else if (!dup) play('scan')
    })()
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [mode, picked, repo, toast])

  const saveManual = (v: TxValues) =>
    run(async () => {
      await repo.addTransaction({ ...v, slipPath: null, slipHash: null, ocrAmount: null })
      onClose()
    }, `บันทึก ${formatBaht(v.amount)} บาทแล้ว`, 'coin')

  const saveSlip = (v: TxValues) =>
    run(async () => {
      if (!slip) return
      const compressed = await compressImage(slip.file)
      const path = await repo.uploadSlip(compressed, monthOf(v.date))
      try {
        await repo.addTransaction({ ...v, slipPath: path, slipHash: slip.hash, ocrAmount: slip.ocrAmount })
      } catch (e) {
        await repo.deleteSlip(path).catch(() => {}) // ไม่ทิ้งรูปกำพร้าไว้ใน storage
        throw e
      }
      onClose()
    }, `บันทึก ${formatBaht(v.amount)} บาทแล้ว`, 'coin')

  const recent = base.data?.recent ?? []
  const categories = orderCategories(base.data?.categories ?? [], recent, today)
  const catById = new Map((base.data?.categories ?? []).map((c) => [c.id, c]))
  const picks = repeatSuggestions(recent, today, 6).filter((p) => catById.get(p.categoryId) && !catById.get(p.categoryId)?.archived)

  /** จดซ้ำ: แตะเดียวบันทึกวันนี้ + ปุ่มเลิกทำ */
  const saveRepeat = async (p: RepeatPick) => {
    const tx = await run(async () => {
      const t = await repo.addTransaction({ date: today, amount: p.amount, categoryId: p.categoryId, note: p.note, slipPath: null, slipHash: null, ocrAmount: null })
      onClose()
      return t
    }, undefined, 'coin')
    if (!tx) return
    toast(`บันทึก ${p.note || catById.get(p.categoryId)?.name || ''} ${formatBaht(p.amount)} บาทแล้ว`, 'info', {
      label: 'เลิกทำ',
      run: () =>
        repo
          .deleteTransaction(tx.id)
          .then(() => {
            bump()
            play('delete')
            toast('เลิกทำแล้ว')
          })
          .catch((e: Error) => toast(e.message || 'เลิกทำไม่สำเร็จ', 'error')),
    })
  }

  const saveSaving = (v: SavingValues) =>
    run(async () => {
      await repo.addSaving({ ...v, kind: 'deposit' })
      onClose()
    }, `เก็บเพิ่ม ${formatBaht(v.amount)} บาทแล้ว`, 'stash')

  const pickSlips = () => {
    warmUpOcr()
    fileRef.current?.click()
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') || f.name.match(/\.(heic|jpe?g|png|webp)$/i))
        e.target.value = '' // เลือกไฟล์เดิมซ้ำได้
        if (!files.length) return
        setPicked(files[0]) // ทีละใบ — ลงทีละรายการอยู่แล้ว
        setMode('slip')
      }}
    />
  )

  if (mode === 'manual') {
    return (
      <Sheet title={kind === 'expense' ? 'เพิ่มรายจ่าย' : 'เก็บเงิน'} onClose={onClose}>
        <div className="seg" role="tablist" aria-label="ประเภท">
          <button role="tab" aria-pressed={kind === 'expense'} aria-selected={kind === 'expense'} onClick={() => { if (kind !== 'expense') primeKeyboard(); setKind('expense') }}>รายจ่าย</button>
          <button role="tab" aria-pressed={kind === 'saving'} aria-selected={kind === 'saving'} onClick={() => { if (kind !== 'saving') primeKeyboard(); setKind('saving') }}>เก็บเงิน</button>
        </div>
        {kind === 'saving' ? (
          <SavingForm busy={busy} submitLabel="เก็บเงิน" autoFocus onSubmit={saveSaving} />
        ) : (
          <>
            {picks.length > 0 && (
              <div className="repeat">
                <div className="repeat-h"><Repeat2 size={14} strokeWidth={1.8} /> จดซ้ำ แตะเดียวบันทึกวันนี้</div>
                <div className="chips">
                  {picks.map((p) => {
                    const c = catById.get(p.categoryId)
                    return (
                      <button key={`${p.categoryId}|${p.note}|${p.amount}`} type="button" className="chip-btn" disabled={busy} onClick={() => saveRepeat(p)}>
                        <CategoryIcon name={c?.icon} size={15} />
                        <span>{p.note || c?.name}</span>
                        <b>{formatBaht(p.amount, { decimals: p.amount % 100 !== 0 })}</b>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {base.data && (
              <TxForm
                categories={categories}
                initial={{ amount: null, date: today, categoryId: null, note: null }}
                busy={busy}
                submitLabel="บันทึก"
                autoFocusAmount
                onSubmit={saveManual}
                amountExtra={
                  <button type="button" className="scan-btn" onClick={pickSlips}>
                    <ScanLine size={17} strokeWidth={1.8} /> มีสลิป? สแกนให้อ่านยอดเอง
                  </button>
                }
              />
            )}
          </>
        )}
        {fileInput}
      </Sheet>
    )
  }

  const title =
    slip && !slip.scanning
      ? slip.ocrAmount !== null
        ? `ยอด ${formatBaht(slip.ocrAmount)} ฿ เป็นค่าอะไร`
        : 'สลิปนี้เป็นค่าอะไร'
      : 'กำลังอ่านสลิป'
  return (
    <Sheet title={title} onClose={onClose}>
      {slip && (
        // รูปเล็กข้างตัวหนังสือ: ให้ทั้งฟอร์ม (ยอด/หมวด/วันที่) พอดีจอโดยไม่ต้องเลื่อน · แตะเพื่อดูเต็ม
        <button type="button" className={`slip-strip ${zoom ? 'zoom' : ''}`} onClick={() => setZoom(!zoom)} aria-label={zoom ? 'ย่อรูปสลิป' : 'ดูรูปสลิปเต็ม'}>
          <img src={slip.url} alt="สลิป" />
          <span>
            <b>{slip.scanning ? 'กำลังอ่านสลิป…' : slip.ocrDate ? `สลิปวันที่ ${dateLabel(slip.ocrDate)}` : 'สลิปที่แนบ'}</b>
            <small>{zoom ? 'แตะเพื่อย่อ' : 'แตะเพื่อดูรูปเต็ม'}</small>
          </span>
        </button>
      )}
      {slip?.dup && (
        <div className="warn">
          สลิปนี้บันทึกไปแล้วเมื่อ {dateLabel(slip.dup.date)} ยอด {formatBaht(slip.dup.amount)} บาท
          <button className="btn ghost" style={{ marginTop: 10, height: 42 }} onClick={onClose}>
            ปิด
          </button>
        </div>
      )}
      {slip?.scanning && (
        <div className="scan">
          กำลังอ่านยอด
          <span className="track"><i style={{ width: `${Math.round(slip.progress * 100)}%` }} /></span>
        </div>
      )}
      {slip && !slip.scanning && !slip.dup && categories.length > 0 && (
        <TxForm
          key={`${slip.ocrAmount}-${slip.ocrDate}`}
          categories={categories}
          initial={{ amount: slip.ocrAmount, date: slip.ocrDate ?? today, categoryId: null, note: null }}
          dateLabel={slip.ocrDate ? 'วันที่ (อ่านจากสลิป)' : 'วันที่'}
          busy={busy}
          submitLabel="บันทึก"
          autoFocusAmount={slip.ocrAmount === null}
          onSubmit={saveSlip}
        />
      )}
    </Sheet>
  )
}
