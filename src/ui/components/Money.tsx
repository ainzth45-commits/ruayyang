import { formatBaht } from '../../domain/money'
import type { Satang } from '../../domain/types'

export function Money({ v, sign, className = '' }: { v: Satang; sign?: boolean; className?: string }) {
  const s = sign && v > 0 ? '+' : ''
  const tone = sign ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : ''
  return <span className={`num ${tone} ${className}`}>{s}{formatBaht(v)}</span>
}
