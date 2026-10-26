import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, monthLabel } from '../../domain/month'
import type { MonthKey } from '../../domain/types'

export function MonthSwitcher({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  return (
    <div className="mswitch">
      <button onClick={() => onChange(addMonths(month, -1))} aria-label="เดือนก่อน">
        <ChevronLeft size={18} strokeWidth={1.6} />
      </button>
      <div className="label">{monthLabel(month)}</div>
      <button onClick={() => onChange(addMonths(month, 1))} aria-label="เดือนถัดไป">
        <ChevronRight size={18} strokeWidth={1.6} />
      </button>
    </div>
  )
}
