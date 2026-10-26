import { useState } from 'react'
import type { Auth } from '../data/repo'
import { isLocalMode } from '../data'
import logo from './assets/logo-login.webp'
import { play } from './sound'

export function Login({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await auth.signIn(email.trim(), password)
      play('welcome')
    } catch (e) {
      play('error')
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login page">
      <img className="login-logo" src={logo} alt="รวยยัง?" width={260} height={260} />
      <div className="eyebrow">Personal finance</div>
      <p>เงินของเรา ชัดทุกบาท · บันทึกรายรับรายจ่ายส่วนตัว</p>
      <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <label className="field">
          <span>อีเมล</span>
          <input className="input" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input className="input" type="password" autoComplete="current-password" enterKeyHint="go" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="warn">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form>
      {isLocalMode && <p className="muted" style={{ fontSize: 12, marginTop: 18, textAlign: 'center' }}>โหมดตัวอย่าง — ใส่อะไรก็ได้</p>}
    </div>
  )
}
