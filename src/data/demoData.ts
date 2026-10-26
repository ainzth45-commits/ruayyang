// ข้อมูลจำลองสำหรับ preview (dev เท่านั้น) — รายจ่ายรายวันหลายหมวดทั้งเดือน, บางรายการมีสลิป,
// รายการประจำจ่ายแล้วบางส่วน — เพื่อให้เห็นหน้าจอหลายสถานะ ไม่ใช่ข้อมูลจริง
import type { Repo } from './repo'
import { addMonths, monthEndDate, monthOf } from '../domain/month'
import { ensureMonths } from '../domain/plan'
import type { Category, DateKey, Satang } from '../domain/types'

type Pick = { cat: string; notes: string[]; min: number; max: number }

// หมวดตามชื่อ (ต้องตรงกับ DEFAULT_CATEGORIES)
const DAILY: Pick[] = [
  { cat: 'อาหาร', notes: ['ข้าวมันไก่', 'กะเพราหมูกรอบ', 'ก๋วยเตี๋ยวเรือ', 'ข้าวผัดปู', 'ส้มตำไก่ย่าง', 'ข้าวขาหมู', 'โจ๊ก'], min: 40, max: 80 },
  { cat: 'อาหาร', notes: ['ข้าวเย็น', 'ซื้อกับข้าวตลาด', 'หมูกระทะ', 'ชาบู'], min: 50, max: 220 },
]
const SOMETIMES: (Pick & { p: number })[] = [
  { cat: 'เครื่องดื่ม', notes: ['อเมซอน', 'ชาไทย', 'กาแฟเย็น', 'ชานมไข่มุก'], min: 35, max: 65, p: 0.4 },
  { cat: 'เดินทาง/น้ำมัน', notes: ['เติมน้ำมัน', 'Grab', 'ค่าทางด่วน'], min: 60, max: 250, p: 0.12 },
  { cat: 'ของใช้', notes: ['7-Eleven', 'Lotus', 'ผงซักฟอก', 'ทิชชู่ + สบู่'], min: 39, max: 260, p: 0.15 },
  { cat: 'ช้อปปิ้ง', notes: ['Shopee', 'Lazada', 'เสื้อยืด'], min: 159, max: 590, p: 0.04 },
  { cat: 'สุขภาพ', notes: ['ร้านยา', 'วิตามิน'], min: 85, max: 300, p: 0.04 },
  { cat: 'บันเทิง', notes: ['Netflix', 'ดูหนัง', 'เติมเกม'], min: 99, max: 220, p: 0.04 },
  { cat: 'ให้/ทำบุญ', notes: ['ทำบุญวัด', 'ใส่บาตร', 'ให้หลาน'], min: 20, max: 200, p: 0.05 },
]

/** pseudo-random คงที่ → ข้อมูลเหมือนเดิมทุกครั้งที่รีเซ็ต */
function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

const roundBaht = (v: number) => Math.round(v / 5) * 5 * 100 // ราคาไทยมักลงท้าย 0/5

export async function seedDemo(repo: Repo, today: DateKey): Promise<void> {
  const month = monthOf(today)
  await ensureMonths(repo, addMonths(month, -1), month)
  const cats = await repo.listCategories()
  const byName = new Map(cats.map((c) => [c.name, c]))
  const cat = (n: string): Category => {
    const c = byName.get(n)
    if (!c) throw new Error(`ไม่พบหมวด ${n}`)
    return c
  }
  const r = rng(20261022)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const day = Number(today.slice(8, 10))

  let slipNo = 0
  for (let d = 1; d <= day; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    const items: { c: Category; note: string; amount: Satang }[] = []
    if (r() > 0.12) items.push(mk(DAILY[0]))
    if (r() > 0.75) items.push(mk(DAILY[1]))
    for (const s of SOMETIMES) if (r() < s.p) items.push(mk(s))
    for (const it of items) {
      const withSlip = it.amount >= 10000 && r() < 0.7
      let slipPath: string | null = null
      let slipHash: string | null = null
      if (withSlip) {
        const img = await drawSlip(it.amount, date, ++slipNo)
        if (img) {
          slipPath = await repo.uploadSlip(img, month)
          slipHash = slipNo.toString(16).padStart(64, 'd') // hex 64 ตัว แบบเดียวกับ sha256
        }
      }
      await repo.addTransaction({ date, amount: it.amount, categoryId: it.c.id, note: it.note, slipPath, slipHash, ocrAmount: withSlip ? it.amount : null })
    }
  }

  // งบใช้จ่าย + เงินเก็บ: ตั้งต้น 25,000 · เดือนที่แล้วแยกเก็บตอนปิด 3,000 · เดือนนี้เก็บระหว่างเดือน
  await repo.setMonthBudget(month, 600_000)
  await repo.saveSettings({ savingsOpening: 2_500_000 })
  const prev = addMonths(month, -1)
  await repo.addSaving({ date: monthEndDate(prev), amount: 300_000, note: 'แยกเก็บตอนปิดเดือน', kind: 'close' })
  await repo.addSaving({ date: `${month}-01`, amount: 100_000, note: 'โอนเข้าออมทรัพย์', kind: 'deposit' })
  if (day >= 15) await repo.addSaving({ date: `${month}-15`, amount: 50_000, note: 'เงินทอนเหลือ', kind: 'deposit' })

  // รายการประจำเดือนนี้: รายรับได้แล้ว + รายจ่ายยอดแน่นอนจ่ายไปครึ่งหนึ่ง (สลับตามลำดับ) ยอดประมาณยังรอจ่าย
  const items = await repo.listItems()
  const byId = new Map(items.map((i) => [i.id, i]))
  const fixedOrder = items.filter((i) => i.kind === 'expense' && !i.isEstimate).map((i) => i.id)
  for (const e of await repo.listEntries(month, month)) {
    const it = byId.get(e.itemId)
    if (!it) continue
    const paid = it.kind === 'income' || (!it.isEstimate && fixedOrder.indexOf(it.id) % 2 === 0)
    if (paid) await repo.updateEntry(e.id, { paid: true })
  }

  function mk(p: Pick): { c: Category; note: string; amount: Satang } {
    return { c: cat(p.cat), note: pick(p.notes), amount: roundBaht(p.min + r() * (p.max - p.min)) }
  }
}

/** รูปสลิปจำลอง (โอนเงินสำเร็จ) วาดด้วย canvas → JPEG */
async function drawSlip(amount: Satang, date: DateKey, n: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null
  const W = 540
  const H = 760
  const cv = new OffscreenCanvas(W, H)
  const g = cv.getContext('2d')
  if (!g) return null
  const bank = [['#138f2d', 'K PLUS'], ['#4e2a84', 'SCB EASY'], ['#1ba5e1', 'Krungthai NEXT']][n % 3]
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.fillStyle = bank[0]
  g.fillRect(0, 0, W, 120)
  g.fillStyle = '#fff'
  g.font = '600 30px sans-serif'
  g.fillText(bank[1], 32, 58)
  g.font = '22px sans-serif'
  g.fillText('โอนเงินสำเร็จ', 32, 96)
  g.fillStyle = '#222'
  g.font = '22px sans-serif'
  g.fillText(`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}  ${String(8 + (n % 12)).padStart(2, '0')}:${String((n * 17) % 60).padStart(2, '0')} น.`, 32, 170)
  g.fillStyle = '#888'
  g.fillText('จาก', 32, 230)
  g.fillText('ไปยัง', 32, 330)
  g.fillStyle = '#222'
  g.font = '600 24px sans-serif'
  g.fillText('นาย สมชาย ใจดี', 32, 266)
  g.fillText(['ร้านค้า พร้อมเพย์', '7-Eleven', 'ปั๊ม ปตท.'][n % 3], 32, 366)
  g.fillStyle = '#888'
  g.font = '22px sans-serif'
  g.fillText('จำนวนเงิน', 32, 470)
  g.fillStyle = '#111'
  g.font = '700 52px sans-serif'
  g.fillText(`${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท`, 32, 536)
  g.fillStyle = '#888'
  g.font = '20px sans-serif'
  g.fillText(`เลขที่รายการ 2026${String(n).padStart(6, '0')}ATF`, 32, 640)
  return cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}
