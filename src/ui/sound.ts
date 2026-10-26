// เสียงในแอป — สังเคราะห์ด้วย Web Audio (ไม่มีไฟล์เสียง/ลิขสิทธิ์) เสียงเบา สั้น เฉพาะจังหวะสำคัญ
// iOS: ใช้ audioSession "ambient" → ปิดเสียงตามสวิตช์เงียบ และไม่ตัดเพลงที่ฟังอยู่

export type SoundName = 'coin' | 'stash' | 'kaching' | 'scan' | 'save' | 'pop' | 'delete' | 'warn' | 'error' | 'welcome'

type Build = (ctx: BaseAudioContext, out: AudioNode, t: number) => number // คืนความยาว (วินาที)

/** โทนเดียวพร้อม envelope (attack เร็ว / decay แบบ exponential) */
function tone(ctx: BaseAudioContext, out: AudioNode, o: {
  f: number; f2?: number; t: number; dur: number; gain: number; type?: OscillatorType; attack?: number
}) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, o.t)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + o.dur * 0.8)
  const a = o.attack ?? 0.005
  g.gain.setValueAtTime(0.0001, o.t)
  g.gain.exponentialRampToValueAtTime(o.gain, o.t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur)
  osc.connect(g).connect(out)
  osc.start(o.t)
  osc.stop(o.t + o.dur + 0.02)
}

/** เสียงคลิกโลหะสั้นๆ (noise ผ่าน high-pass) สำหรับเครื่องคิดเงิน */
function click(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number) {
  const len = Math.floor(ctx.sampleRate * 0.04)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let seed = 7 // pseudo-random คงที่ → เสียงเหมือนกันทุกครั้ง
  for (let i = 0; i < len; i++) {
    seed = (seed * 16807) % 2147483647
    d[i] = ((seed / 2147483647) * 2 - 1) * (1 - i / len) ** 3
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 3500
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(hp).connect(g).connect(out)
  src.start(t)
}

const SOUNDS: Record<SoundName, Build> = {
  // บันทึกรายจ่าย: เหรียญ "ติ๊ง" สองจังหวะ
  coin: (c, out, t) => {
    tone(c, out, { f: 987.8, t, dur: 0.09, gain: 0.16, type: 'square', attack: 0.002 })
    tone(c, out, { f: 1318.5, t: t + 0.075, dur: 0.42, gain: 0.14, type: 'square', attack: 0.002 })
    tone(c, out, { f: 2637, t: t + 0.075, dur: 0.3, gain: 0.04 })
    return 0.55
  },
  // เก็บเงิน: เหรียญหยอดกระปุก 3 เหรียญเสียงไล่ขึ้น + เสียงทุ้มของกระปุก
  stash: (c, out, t) => {
    ;[1174.7, 1396.9, 1760].forEach((f, i) => tone(c, out, { f, t: t + i * 0.07, dur: 0.16, gain: 0.09, type: 'triangle', attack: 0.002 }))
    tone(c, out, { f: 196, f2: 150, t: t + 0.22, dur: 0.3, gain: 0.16 })
    tone(c, out, { f: 2349.3, t: t + 0.22, dur: 0.35, gain: 0.03 })
    return 0.6
  },
  // ติ๊กว่าจ่ายแล้ว: คลิกลิ้นชัก + กระดิ่ง
  kaching: (c, out, t) => {
    click(c, out, t, 0.35)
    click(c, out, t + 0.06, 0.25)
    for (const [f, g] of [[1567.98, 0.12], [2093, 0.08], [3136, 0.035]] as const) {
      tone(c, out, { f, t: t + 0.1, dur: 0.75, gain: g })
    }
    return 0.9
  },
  // อ่านยอดจากสลิปได้: กวาดขึ้น + ติ๊ก
  scan: (c, out, t) => {
    tone(c, out, { f: 620, f2: 1240, t, dur: 0.16, gain: 0.09, type: 'triangle' })
    tone(c, out, { f: 1860, t: t + 0.15, dur: 0.12, gain: 0.07 })
    return 0.3
  },
  // บันทึกทั่วไป: สองโน้ตขึ้นเบาๆ
  save: (c, out, t) => {
    tone(c, out, { f: 659.3, t, dur: 0.12, gain: 0.09 })
    tone(c, out, { f: 987.8, t: t + 0.08, dur: 0.22, gain: 0.08 })
    return 0.32
  },
  // เปิดแผ่นเพิ่มรายการ
  pop: (c, out, t) => {
    tone(c, out, { f: 420, f2: 720, t, dur: 0.08, gain: 0.07 })
    return 0.1
  },
  // ลบ: ไถลลง
  delete: (c, out, t) => {
    tone(c, out, { f: 560, f2: 210, t, dur: 0.22, gain: 0.09, type: 'triangle' })
    return 0.25
  },
  // สลิปซ้ำ/ต้องระวัง: ตุ๊ดตู่สองครั้ง
  warn: (c, out, t) => {
    tone(c, out, { f: 740, t, dur: 0.1, gain: 0.08, type: 'triangle' })
    tone(c, out, { f: 740, t: t + 0.14, dur: 0.12, gain: 0.08, type: 'triangle' })
    return 0.28
  },
  // ทำรายการไม่สำเร็จ: ต่ำ หม่น
  error: (c, out, t) => {
    tone(c, out, { f: 233, f2: 196, t, dur: 0.16, gain: 0.12, type: 'triangle' })
    tone(c, out, { f: 196, f2: 165, t: t + 0.17, dur: 0.22, gain: 0.12, type: 'triangle' })
    return 0.42
  },
  // ล็อกอินสำเร็จ: อาร์เปจจิโอ C–E–G
  welcome: (c, out, t) => {
    ;[1046.5, 1318.5, 1568].forEach((f, i) => tone(c, out, { f, t: t + i * 0.09, dur: 0.5, gain: 0.08 }))
    tone(c, out, { f: 2093, t: t + 0.27, dur: 0.6, gain: 0.04 })
    return 0.9
  },
}

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[]
const PREF_KEY = 'ruayyang-sound'

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* โหมด private บางแบบเขียน storage ไม่ได้ — ไม่เป็นไร */
  }
}

let ctx: AudioContext | null = null

/** เล่นเสียง — ไม่ throw เด็ดขาด (เสียงเป็นของแถม ห้ามทำให้การบันทึกพัง) */
export function play(name: SoundName): void {
  try {
    const log = (window as unknown as { __soundLog?: { name: string; at: number }[] }).__soundLog
    log?.push({ name, at: Date.now() }) // ใช้ตอนอัดคลิปสอนใช้ เพื่อวางเสียงให้ตรงจังหวะ
    if (!isSoundOn() || typeof AudioContext === 'undefined') return
    if (!ctx) {
      const nav = navigator as Navigator & { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'ambient'
      ctx = new AudioContext()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)
    SOUNDS[name](ctx, master, ctx.currentTime + 0.01)
  } catch (e) {
    console.warn('เล่นเสียงไม่ได้', e)
  }
}

/** render เป็น PCM (ใช้ทำคลิป/ทดสอบ) — เสียงเดียวกับที่เล่นในแอป */
export async function renderSound(name: SoundName, sampleRate = 48000): Promise<Float32Array> {
  const probe = new OfflineAudioContext(1, sampleRate, sampleRate)
  const dur = SOUNDS[name](probe, probe.destination, 0) + 0.05
  const off = new OfflineAudioContext(1, Math.ceil(sampleRate * dur), sampleRate)
  SOUNDS[name](off, off.destination, 0)
  const buf = await off.startRendering()
  return buf.getChannelData(0)
}
