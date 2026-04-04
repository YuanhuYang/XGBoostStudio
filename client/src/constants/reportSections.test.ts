import { describe, it, expect } from 'vitest'
import { REPORT_SECTION_OPTIONS } from './reportSections'

describe('REPORT_SECTION_OPTIONS', () => {
  it('includes backend tokens for G2 data_relations and core sections', () => {
    const vals = REPORT_SECTION_OPTIONS.map((o) => o.value)
    expect(vals).toContain('data_relations')
    expect(vals).toContain('executive_summary')
    expect(vals).toContain('evaluation')
    expect(new Set(vals).size).toBe(vals.length)
  })
})
