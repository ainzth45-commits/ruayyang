import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorker, prepareForOcr } = vi.hoisted(() => ({ createWorker: vi.fn(), prepareForOcr: vi.fn() }))
vi.mock('tesseract.js', () => ({ createWorker }))
vi.mock('./image', () => ({ prepareForOcr }))

const file = new Blob(['slip'], { type: 'image/jpeg' })
const result = { data: { text: 'จำนวนเงิน 875.00 บาท' } }
const unavailable = { amount: null, date: null, text: '' }
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve() }
type Progress = { status: string; progress: number; userJobId: string }
function worker() { return { recognize: vi.fn<(_image: Blob, _options?: object, _output?: object, _id?: string) => Promise<typeof result>>(async () => result), terminate: vi.fn(async () => {}) } }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  createWorker.mockReset()
  prepareForOcr.mockReset().mockResolvedValue(file)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('bounded shared receipt OCR', () => {
  it('reads an amount, forwards only its own progress and reuses a healthy worker', async () => {
    const w = worker()
    createWorker.mockResolvedValue(w)
    const { readSlipAmount } = await import('./ocr')
    const progress = vi.fn()
    expect(await readSlipAmount(file, progress)).toMatchObject({ amount: 87_500 })
    const logger = createWorker.mock.calls[0][2].logger as (p: Progress) => void
    logger({ status: 'recognizing text', progress: 0.8, userJobId: String(w.recognize.mock.calls[0]?.[3]) })
    expect(progress).not.toHaveBeenCalled()
    expect(await readSlipAmount(file)).toMatchObject({ amount: 87_500 })
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serializes concurrent reads and ignores delayed progress from the preceding image', async () => {
    let finish!: (value: typeof result) => void
    let finishSecond!: (value: typeof result) => void
    const w = worker()
    w.recognize.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    w.recognize.mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
    createWorker.mockResolvedValue(w)
    const { readSlipAmount } = await import('./ocr')
    const a = vi.fn(), b = vi.fn()
    const first = readSlipAmount(file, a), second = readSlipAmount(file, b)
    await flush()
    expect(w.recognize).toHaveBeenCalledTimes(1)
    const logger = createWorker.mock.calls[0][2].logger as (p: Progress) => void
    const firstId = String(w.recognize.mock.calls[0][3])
    logger({ status: 'recognizing text', progress: 0.4, userJobId: firstId })
    expect(a).toHaveBeenCalledWith(0.4)
    finish(result)
    await first
    await flush()
    expect(w.recognize).toHaveBeenCalledTimes(2)
    const secondId = String(w.recognize.mock.calls[1][3])
    logger({ status: 'recognizing text', progress: 0.9, userJobId: firstId })
    expect(b).not.toHaveBeenCalled()
    logger({ status: 'recognizing text', progress: 0.5, userJobId: secondId })
    expect(b).toHaveBeenCalledExactlyOnceWith(0.5)
    finishSecond(result)
    await expect(second).resolves.toMatchObject({ amount: 87_500 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns unreadable after recognition timeout and uses a fresh worker for the queued next image', async () => {
    const stalled = worker(), healthy = worker()
    stalled.recognize.mockImplementation(() => new Promise(() => {}))
    stalled.terminate.mockImplementation(() => new Promise(() => {}))
    createWorker.mockResolvedValueOnce(stalled).mockResolvedValueOnce(healthy)
    const { readSlipAmount } = await import('./ocr')
    const first = readSlipAmount(file), next = readSlipAmount(file)
    await flush()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(await first).toEqual(unavailable)
    expect(stalled.terminate).toHaveBeenCalledOnce()
    await expect(next).resolves.toMatchObject({ amount: 87_500 })
    expect(createWorker).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out language initialization and terminates its worker if it resolves late', async () => {
    let finish!: (value: ReturnType<typeof worker>) => void
    const late = worker(), healthy = worker()
    createWorker.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce(healthy)
    const { readSlipAmount } = await import('./ocr')
    const first = readSlipAmount(file)
    await flush()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(await first).toEqual(unavailable)
    expect(await readSlipAmount(file)).toMatchObject({ amount: 87_500 })
    finish(late)
    await flush()
    expect(late.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers after a rejected language load or failed recognition without logging slip text', async () => {
    const broken = worker(), healthy = worker()
    broken.recognize.mockRejectedValueOnce(new Error('private slip text'))
    broken.terminate.mockImplementationOnce(() => { throw new Error('already dead') })
    createWorker.mockRejectedValueOnce(new Error('language unavailable')).mockResolvedValueOnce(broken).mockResolvedValueOnce(healthy)
    const { readSlipAmount } = await import('./ocr')
    expect(await readSlipAmount(file)).toEqual(unavailable)
    expect(await readSlipAmount(file)).toEqual(unavailable)
    expect(broken.terminate).toHaveBeenCalledOnce()
    expect(await readSlipAmount(file)).toMatchObject({ amount: 87_500 })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private slip text')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds warm-up and image preparation without hanging the next request', async () => {
    const w = worker(), healthy = worker()
    createWorker.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(w).mockResolvedValueOnce(healthy)
    const { warmUpOcr, readSlipAmount } = await import('./ocr')
    warmUpOcr()
    await flush()
    await vi.advanceTimersByTimeAsync(90_000)
    prepareForOcr.mockImplementationOnce(() => new Promise(() => {}))
    const first = readSlipAmount(file)
    await flush()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(await first).toEqual(unavailable)
    expect(await readSlipAmount(file)).toMatchObject({ amount: 87_500 })
    expect(vi.getTimerCount()).toBe(0)
  })
})
