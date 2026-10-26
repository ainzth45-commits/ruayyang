import { useState } from 'react'
import { Image } from 'lucide-react'
import type { Category, Transaction } from '../../domain/types'
import { useAction, useApp } from '../store'
import { ConfirmButton, Sheet } from './Sheet'
import { TxForm } from './TxForm'

export function TxEditSheet({ tx, categories, onClose }: { tx: Transaction; categories: Category[]; onClose: () => void }) {
  const { repo } = useApp()
  const { busy, run } = useAction()
  const [slipUrl, setSlipUrl] = useState<string | null>(null)

  const showSlip = () =>
    run(async () => {
      if (tx.slipPath) setSlipUrl(await repo.slipUrl(tx.slipPath))
    })

  return (
    <Sheet title="แก้ไขรายจ่าย" onClose={onClose}>
      {slipUrl && <img className="slip-thumb" style={{ maxHeight: 420 }} src={slipUrl} alt="สลิป" />}
      {tx.slipPath && !slipUrl && (
        <button className="btn ghost" style={{ marginBottom: 14 }} onClick={showSlip} disabled={busy}>
          <Image size={18} strokeWidth={1.6} /> ดูรูปสลิป
        </button>
      )}
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
