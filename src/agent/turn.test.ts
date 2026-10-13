import { describe, expect, it } from 'vitest'
import { normalize } from './turn.ts'

describe('normalize', () => {
  it('keeps the screen to four short lines', () => {
    const turn = normalize(
      JSON.stringify({
        speech: '嘴里可以更完整。',
        lines: ['一', '二', '三', '四', '五'],
        mood: 'focus',
        view: 'lines',
      }),
      'zh',
    )
    expect(turn.lines).toEqual(['一', '二', '三', '四'])
    expect(turn.speech).toBe('嘴里可以更完整。')
  })
})
