import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Receipt } from 'lucide-react'
import { discardReceiptUploads, entryReceipts, receiptPaymentCheck, uploadReceipt, validateReceiptFile } from '../../domain/receipt'
import { formatBaht } from '../../domain/money'
import type { MonthEntry, ReceiptCheckMode, ReceiptEvidence } from '../../domain/types'
import { compressImage } from '../../ocr/image'
import { readSlipAmount } from '../../ocr/ocr'
import { useApp } from '../store'
import { loadReceiptBlob } from '../receiptNetwork'
import { ConfirmButton } from './Sheet'

/** รูปและผลอ่านเป็นร่างจนกดบันทึกบิล เพื่อให้ยอด/paid/หลักฐานบันทึกพร้อมกัน */
export function ReceiptAttachment({ entry, disabled, onChange, onBusy, onUploaded, onUseAmount }: {
  entry: MonthEntry
  disabled: boolean
  onChange: (receipts: ReceiptEvidence[], mode: ReceiptCheckMode | null) => void
  onBusy: (busy: boolean) => void
  onUploaded: (path: string) => void
  onUseAmount: (amount: number) => void
}) {
  const { repo, toast } = useApp()
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const replace = useRef<string | null>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const network = useRef<AbortController | null>(null)
  const latest = useRef({ entry, onChange, onBusy, onUploaded })
  latest.current = { entry, onChange, onBusy, onUploaded }
  const receipts = entryReceipts(entry)
  const selected = receipts.find((r) => r.path === selectedPath) ?? receipts[receipts.length - 1]
  const selectedIndex = selected ? receipts.indexOf(selected) + 1 : 0
  const busy = disabled || working !== null
  const check = receiptPaymentCheck(entry)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; network.current?.abort() }
  }, [])

  const perform = async (task: () => Promise<void>) => {
    if (pending.current || disabled) return
    pending.current = true
    setMessage(null)
    setWorking('กำลังเตรียมรูป…')
    latest.current.onBusy(true)
    try { await task() } catch (e) {
      if (mounted.current) setMessage(e instanceof Error ? e.message : 'จัดการหลักฐานไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      pending.current = false
      if (mounted.current) { setWorking(null); latest.current.onBusy(false) }
    }
  }
  const progress = (p: number) => { if (mounted.current) setWorking(`กำลังอ่านยอด ${Math.round(p * 100)}%…`) }

  const choose = (file: File) => {
    if (pending.current || disabled) return
    try { validateReceiptFile(file) } catch (e) { setMessage((e as Error).message); return }
    const replacing = replace.current
    void perform(async () => {
      const jpeg = await compressImage(file)
      if (!mounted.current) return
      setWorking('กำลังอ่านยอดจากสลิป…')
      const { amount } = await readSlipAmount(jpeg, progress)
      if (!mounted.current) return
      setWorking('กำลังอัปโหลดหลักฐาน…')
      const proof = await uploadReceipt(repo, entry.month, jpeg, amount)
      if (!mounted.current) {
        const warning = await discardReceiptUploads(repo, entry, [proof.path])
        if (warning) toast(warning, 'error')
        return
      }
      latest.current.onUploaded(proof.path)
      const current = entryReceipts(latest.current.entry)
      const next = replacing ? current.map((r) => r.path === replacing ? proof : r) : [...current, proof]
      latest.current.onChange(next, latest.current.entry.receiptMode ?? null)
      setSelectedPath(proof.path)
      replace.current = null
    })
  }

  const recheck = (path: string) => void perform(async () => {
    const controller = new AbortController()
    network.current = controller
    try {
      const blob = await loadReceiptBlob(repo, path, controller.signal)
      if (!mounted.current) return
      setWorking('กำลังอ่านยอดจากสลิป…')
      const { amount } = await readSlipAmount(blob, progress)
      if (mounted.current) latest.current.onChange(entryReceipts(latest.current.entry).map((r) => r.path === path ? { ...r, ocrAmount: amount } : r), latest.current.entry.receiptMode ?? null)
    } finally { if (network.current === controller) network.current = null }
  })

  return (
    <section className="receipt-panel" aria-label="หลักฐานการชำระ" style={{ margin: '18px 0', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2><Receipt size={16} strokeWidth={1.7} style={{ verticalAlign: -3, marginRight: 6 }} />หลักฐานการชำระ</h2>
        <span className="meta-t">{receipts.length ? `${receipts.length} รูป` : 'ไม่บังคับ'}</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>เพิ่มได้ทีละรูป · กดบันทึกด้านล่างเพื่อบันทึกหลักฐานพร้อมยอดบิล</p>
      <input ref={input} type="file" accept="image/*,.heic,.heif" aria-label="เลือกรูปหลักฐานการชำระ" hidden disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) choose(file)
      }} />
      {receipts.length > 1 && <div className="receipt-gallery" role="group" aria-label="รูปหลักฐานทั้งหมด">
        {receipts.map((proof, index) => <button key={proof.path} type="button" className="receipt-tile" aria-label={`เลือกรูปหลักฐานที่ ${index + 1}`} aria-pressed={selected?.path === proof.path} onClick={() => setSelectedPath(proof.path)} disabled={busy}>
          <ReceiptPreview path={proof.path} index={index + 1} thumbnail />
          <span>{index + 1} · {proof.ocrAmount === null ? 'อ่านไม่ได้' : formatBaht(proof.ocrAmount)}</span>
        </button>)}
      </div>}
      {selected && <div className="receipt-selected" key={selected.path}>
        <ReceiptPreview path={selected.path} index={selectedIndex} />
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>รูปที่ {selectedIndex}/{receipts.length} · {selected.ocrAmount === null ? 'ยังอ่านยอดรูปนี้ไม่ได้' : `ยอดที่อ่านได้ ${formatBaht(selected.ocrAmount)} บาท`}</p>
        <div className="receipt-tools">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { replace.current = selected.path; input.current?.click() }}>เปลี่ยนรูปที่ {selectedIndex}</button>
          <ConfirmButton key={selected.path} label={`ถอดรูปที่ ${selectedIndex}`} confirmLabel={`ยืนยันถอดรูปที่ ${selectedIndex}`} disabled={busy} onConfirm={() => {
            const next = receipts.filter((r) => r.path !== selected.path)
            onChange(next, next.length > 1 ? entry.receiptMode ?? null : null)
          }} />
          <button type="button" className="btn ghost receipt-reread" disabled={busy} onClick={() => recheck(selected.path)}>อ่านยอดรูปที่ {selectedIndex} ใหม่</button>
        </div>
      </div>}
      <button type="button" className="btn ghost" disabled={busy} onClick={() => { replace.current = null; input.current?.click() }}><ImagePlus size={17} />{receipts.length ? 'แนบหลักฐานเพิ่ม' : 'แนบหลักฐาน'}</button>
      {receipts.length > 1 && <fieldset style={{ border: 0, padding: 0, margin: '14px 0' }} disabled={busy}>
        <legend style={{ fontSize: 14, marginBottom: 8 }}>สลิปเหล่านี้เป็นการชำระแบบไหน?</legend>
        <label className="switch" style={{ gap: 12, minHeight: 44 }}><span>แบ่งจ่ายหลายครั้ง (รวมยอดทุกใบ)</span><input type="radio" name={`receipt-mode-${entry.id}`} checked={entry.receiptMode === 'sum'} onChange={() => onChange(receipts, 'sum')} /></label>
        <label className="switch" style={{ gap: 12, minHeight: 44 }}><span>หลักฐานยอดเดียวกัน (แต่ละใบตรงยอดบิล)</span><input type="radio" name={`receipt-mode-${entry.id}`} checked={entry.receiptMode === 'each'} onChange={() => onChange(receipts, 'each')} /></label>
      </fieldset>}
      {check.status === 'match' && <p role="status" className="pos">ยอดหลักฐานตรงกับยอดบิล</p>}
      {check.status === 'mode-required' && <p className="err-text">เลือกวิธีตรวจยอดหลายสลิปก่อนบันทึกจ่ายแล้ว</p>}
      {check.status === 'unreadable' && <p className="err-text" role="alert">ยังอ่านยอดหลักฐานไม่ได้ กรุณาอ่านใหม่หรือเปลี่ยนรูปก่อนบันทึกจ่ายแล้ว</p>}
      {check.status === 'mismatch' && <div style={{ marginTop: 12 }}>
        <p className="err-text">ยอดหลักฐานไม่ตรงกับยอดบิล ต้องการเปลี่ยนยอดบิลหรือแนบรูปผิด?</p>
        {check.suggestedAmount !== null && <button type="button" className="btn ghost" disabled={busy} onClick={() => onUseAmount(check.suggestedAmount!)}>เปลี่ยนยอดบิลเป็น {formatBaht(check.suggestedAmount)} บาท</button>}
        <p className="muted" style={{ fontSize: 13 }}>ถ้าแนบรูปผิด ให้กดเปลี่ยนรูปใบนั้นด้านบน</p>
      </div>}
      {working && <p className="muted" role="status">{working}</p>}
      {message && <p className="err-text" role="alert">{message}</p>}
    </section>
  )
}

function ReceiptPreview({ path, index, thumbnail = false }: { path: string; index: number; thumbnail?: boolean }) {
  const { repo } = useApp()
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    let url: string | null = null
    setPreview(null); setError(false)
    repo.slipUrl(path).then((value) => {
      if (!alive) { if (value.startsWith('blob:')) URL.revokeObjectURL(value); return }
      url = value; setPreview(value)
    }).catch(() => { if (alive) setError(true) })
    return () => { alive = false; if (url?.startsWith('blob:')) URL.revokeObjectURL(url) }
  }, [repo, path, attempt])
  return <>
    {preview && !error && <img src={preview} alt={thumbnail ? '' : `หลักฐานการชำระบิล ${index}`} className="slip-thumb" onError={() => setError(true)} />}
    {!preview && !error && <span className="muted" role={thumbnail ? undefined : 'status'}>{thumbnail ? '…' : 'กำลังโหลดหลักฐาน…'}</span>}
    {error && (thumbnail ? <span className="err-text">เปิดไม่ได้</span> : <div role="alert"><p className="err-text">เปิดรูปหลักฐานไม่ได้ กรุณาลองโหลดอีกครั้ง</p><button type="button" className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>โหลดหลักฐานอีกครั้ง</button></div>)}
  </>
}
