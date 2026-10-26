import { Receipt } from 'lucide-react'
import type { Category, Transaction } from '../../domain/types'
import { CategoryIcon } from '../icons'
import { Money } from './Money'

export function TxRow({ tx, cat, onClick, meta }: { tx: Transaction; cat: Category | undefined; onClick: () => void; meta?: string }) {
  return (
    <button className="row" onClick={onClick}>
      <span className="glyph"><CategoryIcon name={cat?.icon} /></span>
      <span>
        <div className="title">{tx.note || cat?.name || 'ไม่ระบุหมวด'}</div>
        <div className="meta-t">
          {[tx.note ? cat?.name : null, meta].filter(Boolean).join(' · ')}
          {tx.slipPath && <Receipt size={11} strokeWidth={1.8} style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="มีสลิป" />}
        </div>
      </span>
      <Money v={-tx.amount} className="amt" />
    </button>
  )
}
