import type { ReactNode } from 'react'

/** หัวข้อหน้า (eyebrow ทองเว้นระยะ / หัวข้อใหญ่ / คำอธิบาย) — แถบแบรนด์อยู่ที่ Brandbar ใน Shell */
export function PageHeader(props: { eyebrow: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="title title-row">
      <div>
        <div className="eyebrow">{props.eyebrow}</div>
        <h1>{props.title}</h1>
        {props.sub && <p>{props.sub}</p>}
      </div>
      {props.right}
    </div>
  )
}
