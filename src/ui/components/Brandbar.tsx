import avatar from '../assets/mascot-avatar.webp'

/** แถบแบรนด์ตรึงบนสุดของแอป (อยู่นอกพื้นที่เลื่อน) */
export function Brandbar({ counter }: { counter?: [string, string] }) {
  return (
    <header className="brandbar">
      <div className="brand"><img className="brand-avatar" src={avatar} alt="" width={34} height={34} /><span className="brand-name">รวยยัง<b className="goldtext">?</b></span></div>
      {counter && <div className="counter"><b>{counter[0]}</b> / {counter[1]}</div>}
    </header>
  )
}
