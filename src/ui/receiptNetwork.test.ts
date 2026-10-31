import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadReceiptBlob } from './receiptNetwork'

const image = new Blob(['jpeg'], { type: 'image/jpeg' })
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() }
const timeoutMessage = 'โหลดรูปหลักฐานนานเกินไป'
const abortMessage = 'ยกเลิกการโหลดหลักฐาน'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => image })))
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded receipt image download', () => {
  it.each(['https://storage.example.invalid/signed', 'blob:local-proof'])('loads %s and releases only local object URLs', async (url) => {
    const repo = { slipUrl: vi.fn(async () => url) }
    expect(await loadReceiptBlob(repo, 'proof')).toBe(image)
    expect(repo.slipUrl).toHaveBeenCalledWith('proof')
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    if (url.startsWith('blob:')) expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url)
    else expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['url', 'fetch', 'http', 'body'])('reports %s errors clearly and cleans up', async (stage) => {
    const repo = { slipUrl: vi.fn(async () => 'blob:failed-proof') }
    if (stage === 'url') repo.slipUrl.mockRejectedValueOnce(new Error('private path'))
    if (stage === 'fetch') vi.mocked(fetch).mockRejectedValueOnce(new Error('network'))
    if (stage === 'http') vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    if (stage === 'body') vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: async () => { throw new Error('decode') } } as unknown as Response)
    await expect(loadReceiptBlob(repo, 'proof')).rejects.toThrow('โหลดรูปหลักฐานไม่ได้')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(stage === 'url' ? 0 : 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['url', 'fetch', 'body'])('bounds a hung %s even when it ignores abort', async (stage) => {
    const repo = { slipUrl: vi.fn(async () => 'blob:hung-proof') }
    if (stage === 'url') repo.slipUrl.mockImplementationOnce(() => new Promise(() => {}))
    if (stage === 'fetch') vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}))
    if (stage === 'body') vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: () => new Promise(() => {}) } as unknown as Response)
    const pending = loadReceiptBlob(repo, 'proof')
    const expectation = expect(pending).rejects.toThrow(timeoutMessage)
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    await expectation
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(stage === 'url' ? 0 : 1)
    if (stage !== 'url') expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not fetch after a timed-out signed URL arrives late and revokes its local URL', async () => {
    let finish!: (url: string) => void
    const repo = { slipUrl: vi.fn(() => new Promise<string>((resolve) => { finish = resolve })) }
    const pending = loadReceiptBlob(repo, 'proof')
    const expectation = expect(pending).rejects.toThrow(timeoutMessage)
    await vi.advanceTimersByTimeAsync(30_000)
    await expectation
    finish('blob:late-proof')
    await flush()
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:late-proof')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the request immediately on external abort and removes its listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}))
    const pending = loadReceiptBlob({ slipUrl: async () => 'blob:cancel-proof' }, 'proof', controller.signal)
    const expectation = expect(pending).rejects.toThrow(abortMessage)
    await flush()
    const fetchSignal = vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal
    controller.abort()
    await expectation
    expect(fetchSignal.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:cancel-proof')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not begin a lookup for a previously aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const repo = { slipUrl: vi.fn(async () => 'blob:unused') }
    await expect(loadReceiptBlob(repo, 'proof', controller.signal)).rejects.toThrow(abortMessage)
    expect(repo.slipUrl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one overall deadline rather than restarting it after the signed URL loads', async () => {
    let finish!: (url: string) => void
    const repo = { slipUrl: vi.fn(() => new Promise<string>((resolve) => { finish = resolve })) }
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}))
    const pending = loadReceiptBlob(repo, 'proof')
    const expectation = expect(pending).rejects.toThrow(timeoutMessage)
    await vi.advanceTimersByTimeAsync(20_000)
    finish('blob:slow-url')
    await flush()
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:slow-url')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('revokes a local signed URL that resolves after external cancellation', async () => {
    let finish!: (url: string) => void
    const controller = new AbortController()
    const repo = { slipUrl: vi.fn(() => new Promise<string>((resolve) => { finish = resolve })) }
    const pending = loadReceiptBlob(repo, 'proof', controller.signal)
    const expectation = expect(pending).rejects.toThrow(abortMessage)
    controller.abort()
    await expectation
    finish('blob:late-cancelled-url')
    await flush()
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:late-cancelled-url')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start reading a response that arrives after timeout', async () => {
    let finish!: (response: Response) => void
    const body = vi.fn(async () => image)
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = loadReceiptBlob({ slipUrl: async () => 'blob:late-response' }, 'proof')
    const expectation = expect(pending).rejects.toThrow(timeoutMessage)
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    await expectation
    finish({ ok: true, blob: body } as unknown as Response)
    await flush()
    expect(body).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:late-response')
    expect(vi.getTimerCount()).toBe(0)
  })
})
