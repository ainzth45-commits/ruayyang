import type { InputHTMLAttributes, KeyboardEvent } from 'react'

/** Enter บนแป้น = ปิดแป้น (ไม่ submit ฟอร์มที่ยังกรอกไม่ครบ) */
export const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

/** ช่องยอดเงิน: แป้นตัวเลขมีจุด, ไม่แก้คำ, ปุ่ม Enter = "เสร็จ" */
export const moneyInputProps: InputHTMLAttributes<HTMLInputElement> = {
  inputMode: 'decimal',
  enterKeyHint: 'done',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  onKeyDown: blurOnEnter,
}

/** ช่องข้อความสั้น (ชื่อ/โน้ต) */
export const textInputProps: InputHTMLAttributes<HTMLInputElement> = {
  enterKeyHint: 'done',
  autoComplete: 'off',
}
