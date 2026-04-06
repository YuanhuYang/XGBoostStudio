import { describe, expect, it } from 'vitest'
import { showTeachingUi } from './teachingUi'

describe('showTeachingUi', () => {
  it('enables teaching UI for guided, preprocess and learning; disables for expert', () => {
    expect(showTeachingUi('guided')).toBe(true)
    expect(showTeachingUi('preprocess')).toBe(true)
    expect(showTeachingUi('learning')).toBe(true)
    expect(showTeachingUi('expert')).toBe(false)
  })
})
