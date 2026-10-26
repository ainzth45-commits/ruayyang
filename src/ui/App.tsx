import { useEffect, useRef, useState } from 'react'
import { CalendarDays, House, Layers, Plus, Settings2 } from 'lucide-react'
import { createBackend, type Backend } from '../data'
import type { AuthUser } from '../data/repo'
import { bangkokToday, monthOf } from '../domain/month'
import { ensureDefaultCategories } from '../domain/plan'
import type { MonthKey } from '../domain/types'
import { AddSheet } from './components/AddSheet'
import { Brandbar } from './components/Brandbar'
import { Login } from './Login'
import { Daily } from './screens/Daily'
import { Home } from './screens/Home'
import { Plan } from './screens/Plan'
import { Settings } from './screens/Settings'
import { AppProvider } from './store'
import { play } from './sound'
import { primeKeyboard } from './viewport'

type Tab = 'home' | 'daily' | 'plan' | 'settings'
const TABS: Tab[] = ['home', 'daily', 'plan', 'settings']
const tabFromHash = (): Tab => {
  const t = location.hash.slice(1) as Tab
  return TABS.includes(t) ? t : 'home'
}

export function App() {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let off: (() => void) | undefined
    let alive = true
    createBackend()
      .then(async (b) => {
        if (!alive) return
        setBackend(b)
        off = b.auth.onChange(setUser)
        const u = await b.auth.currentUser()
        if (alive) setUser(u)
      })
      .catch((e: Error) => alive && setFatal(e.message))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (fatal) return <div className="login"><div className="warn">{fatal}</div></div>
  if (!backend || user === undefined) return <div className="loading"><div className="spinner" /></div>
  if (!user) return <Login auth={backend.auth} />
  return (
    <AppProvider repo={backend.repo} auth={backend.auth} user={user}>
      <Shell backend={backend} />
    </AppProvider>
  )
}

function Shell({ backend }: { backend: Backend }) {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [adding, setAdding] = useState(false)
  const [planMonth, setPlanMonth] = useState<MonthKey>(monthOf(bangkokToday()))
  const [ready, setReady] = useState(false)
  const scroller = useRef<HTMLElement>(null)

  useEffect(() => {
    ensureDefaultCategories(backend.repo)
      .catch((e) => console.error('สร้างหมวดเริ่มต้นไม่สำเร็จ', e))
      .finally(() => setReady(true))
  }, [backend])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    if (t === tab) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
    else scroller.current?.scrollTo({ top: 0 })
    history.replaceState(null, '', `#${t}`)
    setTab(t)
  }

  if (!ready) return <div className="loading"><div className="spinner" /></div>

  return (
    <div className="app">
      <Brandbar />
      <main className="scroller" ref={scroller}>
        {tab === 'home' && <Home onOpenPlan={() => { setPlanMonth(monthOf(bangkokToday())); go('plan') }} />}
        {tab === 'daily' && <Daily />}
        {tab === 'plan' && <Plan month={planMonth} onMonth={setPlanMonth} />}
        {tab === 'settings' && <Settings />}
      </main>

      <nav className="tabbar" aria-label="เมนู">
        <div className="tabbar-inner">
          <TabButton icon={<House size={22} strokeWidth={1.5} />} label="หน้าหลัก" active={tab === 'home'} onClick={() => go('home')} />
          <TabButton icon={<CalendarDays size={22} strokeWidth={1.5} />} label="รายวัน" active={tab === 'daily'} onClick={() => go('daily')} />
          <button className="fab" aria-label="เพิ่มรายจ่าย" onClick={() => { primeKeyboard(); play('pop'); setAdding(true) }}>
            <Plus size={26} strokeWidth={1.8} />
          </button>
          <TabButton icon={<Layers size={22} strokeWidth={1.5} />} label="แผนเดือน" active={tab === 'plan'} onClick={() => go('plan')} />
          <TabButton icon={<Settings2 size={22} strokeWidth={1.5} />} label="ตั้งค่า" active={tab === 'settings'} onClick={() => go('settings')} />
        </div>
      </nav>

      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

function TabButton(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="tab" aria-current={props.active ? 'page' : undefined} onClick={props.onClick}>
      {props.icon}
      {props.label}
    </button>
  )
}
