import { describe, expect, it } from 'vitest'
import { applyTurn, markDueTimers } from './apply.ts'
import { emptyScene } from './types.ts'

describe('applyTurn', () => {
  it('pins and then dismisses a card', () => {
    const pinned = applyTurn(emptyScene(), {
      speech: '天气钉上了。',
      cards: [{ id: 'weather:成都', type: 'weather', city: '成都', temp: '22°', condition: '多云' }],
      view: 'weather',
    })
    expect(pinned.cards).toHaveLength(1)
    const cleared = applyTurn(pinned, { speech: '拿掉了。', dismiss: ['type:weather'] })
    expect(cleared.cards).toHaveLength(0)
  })

  it('turns the room red when a timer is due', () => {
    const scene = {
      ...emptyScene(),
      cards: [{ id: 'timer:1', type: 'timer' as const, title: '喝水', endsAt: 1_000 }],
    }
    const next = markDueTimers(scene, 1_500)
    expect(next.mood).toBe('alert')
    expect(next.view).toBe('timer')
    expect(next.cards[0]?.alerted).toBe(true)
  })
})
