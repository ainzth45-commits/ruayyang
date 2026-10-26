import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Auth, AuthUser, Repo } from '../data/repo'
import { play, type SoundName } from './sound'

export interface ToastAction { label: string; run: () => void }
interface Toast { id: number; text: string; kind: 'info' | 'error'; action?: ToastAction }

interface Ctx {
  repo: Repo
  auth: Auth
  user: AuthUser
  /** เพิ่มทุกครั้งที่ข้อมูลเปลี่ยน — หน้าจอใช้เป็น dependency เพื่อโหลดใหม่ */
  version: number
  bump: () => void
  toast: (text: string, kind?: 'info' | 'error', action?: ToastAction) => void
}

const C = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const v = useContext(C)
  if (!v) throw new Error('useApp นอก AppProvider')
  return v
}

export function AppProvider(props: { repo: Repo; auth: Auth; user: AuthUser; children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [toastState, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info', action?: ToastAction) => {
    window.clearTimeout(timer.current)
    setToast({ id: Date.now(), text, kind, action })
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : kind === 'error' ? 4500 : 2400)
  }, [])
  return (
    <C.Provider value={{ repo: props.repo, auth: props.auth, user: props.user, version, bump, toast }}>
      {props.children}
      {toastState && (
        <div key={toastState.id} className={`toast ${toastState.kind}`} role="status">
          <span>{toastState.text}</span>
          {toastState.action && (
            <button
              className="toast-act"
              onClick={() => {
                const a = toastState.action
                setToast(null)
                a?.run()
              }}
            >
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
    </C.Provider>
  )
}

/** โหลดข้อมูลแบบ async พร้อมจัดการ error ด้วย toast; โหลดใหม่เมื่อ deps หรือ version เปลี่ยน */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; reload: () => void } {
  const { version, toast } = useApp()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && toast(e.message || 'โหลดข้อมูลไม่สำเร็จ', 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick])
  return { data, loading, reload: () => setTick((t) => t + 1) }
}

/** ห่อ action ที่เขียนข้อมูล: กันกดซ้ำ + toast error + bump เมื่อสำเร็จ */
export function useAction() {
  const { bump, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string, sound?: SoundName): Promise<T | undefined> => {
      if (busy) return undefined
      setBusy(true)
      try {
        const r = await fn()
        bump()
        if (sound) play(sound)
        if (okText) toast(okText)
        return r
      } catch (e) {
        play('error')
        toast((e as Error).message || 'ทำรายการไม่สำเร็จ', 'error')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [busy, bump, toast],
  )
  return { busy, run }
}
