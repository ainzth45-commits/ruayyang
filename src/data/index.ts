import type { Auth, Repo } from './repo'

export interface Backend {
  repo: Repo
  auth: Auth
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isLocalMode = !(url && key)

let instance: Promise<Backend> | null = null

/** singleton — กัน StrictMode/รีเรนเดอร์สร้าง client ซ้ำ (และกัน seed ถูก import สองรอบพร้อมกัน) */
export function createBackend(): Promise<Backend> {
  instance ??= build().catch((e) => {
    instance = null
    throw e
  })
  return instance
}

async function build(): Promise<Backend> {
  if (!isLocalMode) {
    const [{ createClient }, { SupabaseRepo, SupabaseAuth }] = await Promise.all([
      import('@supabase/supabase-js'),
      import('./supabaseRepo'),
    ])
    const sb = createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ledger-auth' },
    })
    return { repo: new SupabaseRepo(sb), auth: new SupabaseAuth(sb) }
  }

  // เงื่อนไข DEV ตรงๆ ให้ bundler ตัดโมดูล local (และ seed ส่วนตัว) ออกจาก production build
  if (import.meta.env.DEV) {
    const { createLocalBackend } = await import('./localBackend')
    return createLocalBackend()
  }
  // build production ต้องมี Supabase เสมอ — กันเผลอ deploy แบบเก็บข้อมูลในเครื่อง
  throw new Error('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}
