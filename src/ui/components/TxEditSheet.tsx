import { useEffect, useState } from 'react'
import type { Category, Transaction } from '../../domain/types'
import { useAction, useApp } from '../store'
import { ConfirmButton, Sheet } from './Sheet'
import { TxForm } from './TxForm'

export function TxEditSheet({ tx, categories, onClose }: { tx: Transaction; categories: Category[]; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [preview, setPreview] = useState<{ path: string; url?: string; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const current = preview?.path === tx.slipPath ? preview : null

  useEffect(() => {
    const path = tx.slipPath
    let alive = true
    let localUrl: string | null = null
    setPreview(null)
    if (path) {
      repo.slipUrl(path)
        .then((url) => {
          if (!alive) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url)
            return
          }
          localUrl = url
          setPreview({ path, url })
        })
        .catch(() => { if (alive) setPreview({ path, error: 'เปิดรูปสลิปไม่ได้ กรุณาลองโหลดอีกครั้ง' }) })
    }
    return () => {
      alive = false
      if (localUrl?.startsWith('blob:')) URL.revokeObjectURL(localUrl)
    }
  }, [repo, tx.slipPath, attempt])

  return (
    <Sheet title="แก้ไขรายจ่าย" onClose={onClose}>
      {tx.slipPath && !current && <p className="muted" role="status">กำลังโหลดสลิป…</p>}
      {current?.url && <img className="slip-thumb" style={{ maxHeight: 420 }} src={current.url} alt="สลิป" onError={() => setPreview({ path: current.path, error: 'เปิดรูปสลิปไม่ได้ กรุณาลองโหลดอีกครั้ง' })} />}
      {current?.error && <div role="alert">
        <p className="err-text">{current.error}</p>
        <button type="button" className="btn ghost" style={{ marginBottom: 14 }} onClick={() => setAttempt((n) => n + 1)}>โหลดสลิปอีกครั้ง</button>
      </div>}
      <TxForm
        categories={categories}
        initial={tx}
        busy={busy}
        submitLabel="บันทึกการแก้ไข"
        onSubmit={(v) =>
          run(async () => {
            await repo.updateTransaction(tx.id, v)
            onClose()
          }, 'แก้ไขแล้ว', 'save')
        }
        footer={
          <div style={{ marginTop: 10 }}>
            <ConfirmButton
              label="ลบรายการนี้"
              confirmLabel="แตะอีกครั้งเพื่อยืนยันการลบ"
              disabled={busy}
              onConfirm={() =>
                run(async () => {
                  await repo.deleteTransaction(tx.id)
                  if (tx.slipPath) await repo.deleteSlip(tx.slipPath).catch((e) => console.warn('ลบรูปสลิปไม่สำเร็จ', e))
                  onClose()
                }, 'ลบแล้ว', 'delete')
              }
            />
          </div>
        }
      />
    </Sheet>
  )
}
