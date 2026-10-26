// ตรวจ seed จริงจากชีต (private/seed.json — มีเฉพาะในเครื่องเจ้านาย ไม่อยู่ใน repo)
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../src/data/localRepo'
import { summarizeMonth } from '../src/domain/calc'
import { toSatang } from '../src/domain/money'
import { importSeed, type Seed } from '../src/domain/plan'

const path = new URL('../private/seed.json', import.meta.url)
const has = existsSync(path)

describe.skipIf(!has)('import จากชีตจริง', () => {
  it('คงเหลือทุกเดือนในแอป = แถว "คงเหลือ" ในชีต', async () => {
    const seed = JSON.parse(readFileSync(path, 'utf8')) as Seed & { expected_remaining: Record<string, string> }
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await importSeed(repo, seed)
    const items = await repo.listItems()
    const entries = await repo.listEntries('2000-01', '9999-12')
    const records = await repo.listMonths('2000-01', '9999-12')
    expect(records).toHaveLength(seed.months.length)
    for (const rec of records) {
      const s = summarizeMonth(rec.month, items, entries, [], rec)
      expect(s.planLeft, rec.month).toBe(toSatang(seed.expected_remaining[rec.month]))
    }
  })
})
