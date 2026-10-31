import type { Repo } from '../data/repo'

const RECEIPT_LOAD_TIMEOUT_MS = 30_000

/** ดาวน์โหลดรูปสำหรับอ่านยอด มี deadline รวมถึง signed URL และอ่าน response body */
export async function loadReceiptBlob(repo: Pick<Repo, 'slipUrl'>, path: string, signal?: AbortSignal): Promise<Blob> {
  const abortError = () => new Error('ยกเลิกการโหลดหลักฐานแล้ว')
  if (signal?.aborted) throw abortError()

  const controller = new AbortController()
  let active = true
  let localUrl: string | null = null
  let stopped: Error | null = null
  let rejectStop!: (error: Error) => void
  const cancellation = new Promise<never>((_resolve, reject) => { rejectStop = reject })
  const stop = (error: Error) => {
    if (!active) return
    active = false
    stopped = error
    controller.abort()
    rejectStop(error)
  }
  const onAbort = () => stop(abortError())
  const timer = setTimeout(() => stop(new Error('โหลดรูปหลักฐานนานเกินไป กรุณาลองใหม่')), RECEIPT_LOAD_TIMEOUT_MS)
  signal?.addEventListener('abort', onAbort, { once: true })

  const release = (url: string) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  const load = async () => {
    const url = await repo.slipUrl(path)
    if (!active) {
      release(url)
      throw stopped ?? abortError()
    }
    localUrl = url
    const response = await fetch(url, { signal: controller.signal })
    if (!active) throw stopped ?? abortError()
    if (!response.ok) throw new Error('Receipt response failed')
    const blob = await response.blob()
    if (!active) throw stopped ?? abortError()
    return blob
  }

  try {
    return await Promise.race([load(), cancellation])
  } catch {
    throw stopped ?? new Error('โหลดรูปหลักฐานไม่ได้ กรุณาลองใหม่')
  } finally {
    active = false
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    controller.abort()
    if (localUrl) release(localUrl)
  }
}
