// โหมด preview ในเครื่อง (dev เท่านั้น) — import แบบ dynamic จาก index.ts ภายใต้ import.meta.env.DEV
import type { Backend } from './index'
import type { Auth, AuthUser } from './repo'
import { indexedDbSlipStore, LocalRepo } from './localRepo'
import { bangkokToday } from '../domain/month'
import { ensureDefaultCategories, importSeed, type Seed } from '../domain/plan'
import { seedDemo } from './demoData'

const DEMO_FLAG = 'ruayyang-demo'
const DEMO_VERSION = '3'

/** ล้างข้อมูลโหมด preview ทั้งหมด (localStorage ของแอป + รูปสลิปใน IndexedDB) */
export async function resetLocalData(): Promise<void> {
  localStorage.removeItem('ledger-local-v1')
  localStorage.removeItem(DEMO_FLAG)
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('ledger-slips')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

export async function createLocalBackend(): Promise<Backend> {
  // preview.html เปิดด้วย ?demo=1 → ล้างแล้วใส่ข้อมูลจำลองครั้งเดียว (เปลี่ยน DEMO_VERSION เพื่อรีเซ็ตใหม่)
  const wantDemo = new URLSearchParams(location.search).has('demo')
  if (wantDemo && localStorage.getItem(DEMO_FLAG) !== DEMO_VERSION) await resetLocalData()
  const repo = new LocalRepo(localStorage, indexedDbSlipStore())
  if (repo.isEmpty()) {
    // โหลดข้อมูลจากชีตจริง (private/seed.json ไม่อยู่ใน repo) ผ่าน middleware ของ dev server ใน vite.config.ts
    const res = await fetch(`${import.meta.env.BASE_URL}__dev/seed.json`).catch(() => null)
    if (res?.ok) await importSeed(repo, (await res.json()) as Seed)
    if (wantDemo) {
      await ensureDefaultCategories(repo)
      await seedDemo(repo, bangkokToday())
      localStorage.setItem(DEMO_FLAG, DEMO_VERSION)
    }
  }
  return { repo, auth: localAuth() }
}

/** login จำลองสำหรับ preview — รหัสอะไรก็ได้ที่ไม่ว่าง */
function localAuth(): Auth {
  const KEY = 'ledger-local-user'
  const listeners = new Set<(u: AuthUser | null) => void>()
  const read = (): AuthUser | null => {
    const v = localStorage.getItem(KEY)
    return v ? { id: 'local', email: v } : null
  }
  return {
    async currentUser() { return read() },
    async signIn(email, password) {
      if (!email.trim() || !password) throw new Error('กรุณากรอกอีเมลและรหัสผ่าน')
      localStorage.setItem(KEY, email.trim())
      const u = read()!
      listeners.forEach((l) => l(u))
      return u
    },
    async signOut() {
      localStorage.removeItem(KEY)
      listeners.forEach((l) => l(null))
    },
    onChange(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
  }
}
