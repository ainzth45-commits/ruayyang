// ทำให้เว็บแอปรู้สึกเหมือนแอป iPhone:
// - แป้นพิมพ์ "ดันแอปขึ้น" แบบไลน์: อ่าน visualViewport → CSS vars ให้ .app สูงเท่าพื้นที่ที่เหลือ, แผ่นเกาะบนแป้น
// - ไม่ให้ทั้งหน้าเด้ง/เลื่อน (เลื่อนได้เฉพาะ .scroller / .sheet) และไม่ให้ถ่างนิ้วซูม

export interface ViewportVars {
  /** ความสูงที่มองเห็นจริง (หักแป้นพิมพ์แล้ว) */
  vvh: number
  /** iOS เลื่อน layout viewport ลงมาเท่าไหร่ */
  vvt: number
  /** ความสูงแป้นพิมพ์ (ส่วนที่บังด้านล่างของ layout viewport) */
  kb: number
  open: boolean
}

/** ส่วนต่าง > 120px ถึงจะนับว่าแป้นเปิด (กันแถบ URL ยืด/หด) */
const KB_MIN = 120

/** layoutHeight = ความสูงจอตอนแป้นปิด (ไม่ใช่ window.innerHeight ตอนแป้นเปิด — iOS หดค่านั้นตามแป้น) */
export function computeViewport(layoutHeight: number, vvHeight: number, vvOffsetTop: number): ViewportVars {
  const vvh = Math.round(vvHeight)
  const vvt = Math.max(0, Math.round(vvOffsetTop))
  return { vvh, vvt, kb: Math.max(0, Math.round(layoutHeight - vvHeight - vvOffsetTop)), open: layoutHeight - vvHeight > KB_MIN }
}

const SCROLLABLE = '.scroller, .sheet, .login, .chips'

let installed = false

export function installViewport(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const root = document.documentElement
  const vv = window.visualViewport

  // ความสูงจอตอนแป้นปิด: iOS ลด window.innerHeight ตามแป้นด้วย (เป็น visual viewport) → ใช้เทียบไม่ได้
  // จึงจำค่าล่าสุดตอนไม่มีช่องกรอกถูก focus ไว้ (หมุนจอ/แถบ URL เปลี่ยนก็อัปเดตตาม)
  let baseH = 0
  const typing = () => !!(document.activeElement as Element | null)?.matches?.('input, textarea, select, [contenteditable]')
  const layoutHeight = () => {
    const h = Math.max(document.documentElement.clientHeight, window.innerHeight)
    if (!typing() || baseH === 0) baseH = h
    return Math.max(baseH, h)
  }

  const apply = () => {
    if (!vv) return
    const v = computeViewport(layoutHeight(), vv.height, vv.offsetTop)
    root.style.setProperty('--vvh', `${v.vvh}px`)
    root.style.setProperty('--vvt', `${v.vvt}px`)
    root.style.setProperty('--kb', `${v.kb}px`)
    root.classList.toggle('kb-open', v.open)
  }
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('orientationchange', () => { baseH = 0; window.setTimeout(apply, 300) })
  document.addEventListener('focusout', () => window.setTimeout(apply, 50))
  apply()

  // iOS ชอบเลื่อนทั้งหน้าตอน focus ช่องกรอก — ดึงกลับ (เราจัดตำแหน่งเองด้วย --vvt/--kb แล้ว)
  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 && !root.classList.contains('kb-open')) window.scrollTo(0, 0)
  })

  // ห้ามถ่างนิ้วซูม (Safari ไม่สน user-scalable=no)
  const stop = (e: Event) => e.preventDefault()
  document.addEventListener('gesturestart', stop, { passive: false })
  document.addEventListener('gesturechange', stop, { passive: false })
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) return e.preventDefault()
      // ลากบนพื้นที่ที่เลื่อนไม่ได้ (หัว/แถบเมนู) → ไม่ให้ทั้งหน้าเด้ง
      const t = e.target as Element | null
      if (!t?.closest?.(SCROLLABLE)) e.preventDefault()
    },
    { passive: false },
  )
  // แตะสองครั้งไม่ซูม: ใช้ touch-action ใน CSS (ไม่ดัก touchend เพราะจะกลืนการแตะเร็วๆ ติดกัน)
}

/**
 * iOS เปิดแป้นพิมพ์เฉพาะ focus ที่เกิดใน gesture ของผู้ใช้ — เรียกในตัว onClick ก่อนเปิดแผ่น
 * แล้วช่องจริง (autoFocus) จะรับ focus ต่อโดยแป้นไม่ปิด
 */
export function primeKeyboard(): void {
  let el = document.getElementById('kb-proxy') as HTMLInputElement | null
  if (!el) {
    el = Object.assign(document.createElement('input'), { id: 'kb-proxy', inputMode: 'decimal', tabIndex: -1 })
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  el.focus({ preventScroll: true })
}
