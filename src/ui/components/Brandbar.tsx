import { useId } from 'react'
import { bangkokToday, daysInMonth, monthLabel, monthOf } from '../../domain/month'
import avatar from '../assets/mascot-avatar.webp'

/** แถบแบรนด์ตรึงบนสุดของแอป (อยู่นอกพื้นที่เลื่อน) · ขวา = วงแหวนวันของเดือน ทุกหน้า */
export function Brandbar() {
  const today = bangkokToday()
  const month = monthOf(today)
  const day = Number(today.slice(8, 10))
  const total = daysInMonth(month)
  return (
    <header className="brandbar">
      <div className="brand"><img className="brand-avatar" src={avatar} alt="" width={34} height={34} /><span className="brand-name">รวยยัง<b className="goldtext">?</b></span></div>
      <div className="daychip" aria-label={`วันที่ ${day} จาก ${total} วัน เหลือ ${total - day} วัน`}>
        <div className="daychip-t">
          <b>{monthLabel(month)}</b>
          <span>{total - day === 0 ? 'วันสุดท้ายของเดือน' : `อีก ${total - day} วันสิ้นเดือน`}</span>
        </div>
        <DayRing day={day} total={total} />
      </div>
    </header>
  )
}

function DayRing({ day, total }: { day: number; total: number }) {
  const id = useId()
  const R = 17
  const C = 2 * Math.PI * R
  return (
    <span className="dayring">
      <svg viewBox="0 0 42 42" width="42" height="42" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ecd29b" />
            <stop offset=".55" stopColor="#c79b4c" />
            <stop offset="1" stopColor="#0f7f8f" />
          </linearGradient>
        </defs>
        <circle cx="21" cy="21" r={R} fill="none" stroke="#efede8" strokeWidth="3.5" />
        <circle cx="21" cy="21" r={R} fill="none" stroke={`url(#${id})`} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - day / total)} transform="rotate(-90 21 21)" />
      </svg>
      <b>{day}</b>
    </span>
  )
}
