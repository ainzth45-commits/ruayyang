import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Receipt, X } from 'lucide-react'
import { attachReceipt, detachReceipt, validateReceiptFile, type ReceiptResult } from '../../domain/receipt'
import type { MonthEntry } from '../../domain/types'
import { compressImage } from '../../ocr/image'
import { useAction, useApp } from '../store'
import { ConfirmButton } from './Sheet'

/** หลักฐานผูกกับบิลของเดือนนั้นโดยตรง และแนบย้อนหลังหลังจ่ายแล้วได้ */
export function ReceiptAttachment({ entry }: { entry: MonthEntry }) {
  const { repo, toast } = useApp()
  const { busy, run } = useAction()
  const [path, setPath] = useState(entry.receiptPath ?? null)
  const [preview, setPreview] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    setPath(entry.receiptPath ?? null)
    setPreview(null)
    setMessage(null)
  }, [entry.id, entry.receiptPath])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => () => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
  }, [preview])

  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setMessage(null)
    try {
      await run(async () => {
        try {
          await action()
        } catch (error) {
          if (mounted.current) setMessage(error instanceof Error ? error.message : 'จัดการหลักฐานไม่สำเร็จ กรุณาลองใหม่')
          throw error
        }
      })
    } finally {
      pending.current = false
    }
  }

  const saved = (result: ReceiptResult, success: string) => {
    if (!mounted.current) return
    setPath(result.receiptPath)
    setPreview(null)
    setMessage(result.warning)
    toast(result.warning ?? success, result.warning ? 'error' : 'info')
  }

  const choose = (file: File) => {
    if (pending.current) return
    try {
      validateReceiptFile(file)
    } catch (error) {
      setMessage((error as Error).message)
      return
    }
    void perform(async () => {
      const jpeg = await compressImage(file)
      saved(await attachReceipt(repo, { ...entry, receiptPath: path }, jpeg), 'แนบหลักฐานแล้ว')
    })
  }

  const show = () => void perform(async () => {
    if (!path) return
    const url = await repo.slipUrl(path)
    if (mounted.current) setPreview(url)
    else if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  })

  return (
    <section className="receipt-panel" aria-label="หลักฐานการชำระ" style={{ margin: '18px 0', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2><Receipt size={16} strokeWidth={1.7} style={{ verticalAlign: -3, marginRight: 6 }} />หลักฐานการชำระ</h2>
        <span className="meta-t">{path ? 'แนบแล้ว' : 'ไม่บังคับ'}</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>สลิปหรือใบเสร็จ 1 รูป · แนบย้อนหลังได้ โดยไม่เพิ่มรายจ่ายซ้ำ</p>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        aria-label="เลือกรูปหลักฐานการชำระ"
        hidden
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) choose(file)
        }}
      />
      {preview && (
        <>
          <img
            src={preview}
            alt="หลักฐานการชำระบิล"
            className="slip-thumb"
            style={{ maxHeight: 360 }}
            onError={() => { setPreview(null); setMessage('เปิดรูปหลักฐานไม่ได้ กรุณาลองดูอีกครั้ง') }}
          />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setPreview(null)}>
            <X size={17} />ซ่อนหลักฐาน
          </button>
        </>
      )}
      <div className="receipt-actions" style={{ display: 'grid', gridTemplateColumns: path ? '1fr 1fr' : '1fr', gap: 8, marginTop: preview ? 10 : 0 }}>
        {path && !preview && <button type="button" className="btn ghost" disabled={busy} onClick={show}>ดูหลักฐาน</button>}
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 0, gridColumn: preview ? '1 / -1' : undefined }}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={17} strokeWidth={1.7} />{path ? 'เปลี่ยนรูปหลักฐาน' : 'แนบหลักฐาน'}
        </button>
      </div>
      {path && (
        <div style={{ marginTop: 10 }}>
          <ConfirmButton
            label="ถอดหลักฐาน"
            confirmLabel="ยืนยันถอดหลักฐาน"
            disabled={busy}
            onConfirm={() => void perform(async () => saved(await detachReceipt(repo, { ...entry, receiptPath: path }), 'ถอดหลักฐานแล้ว'))}
          />
        </div>
      )}
      {busy && <p className="muted" role="status" style={{ fontSize: 12.5 }}>กำลังจัดการหลักฐาน…</p>}
      {message && <p className="err-text" role="alert">{message}</p>}
    </section>
  )
}
