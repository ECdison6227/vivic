import type { Scene, SceneCard, Turn } from './types.ts'

export function applyTurn(scene: Scene, turn: Turn): Scene {
  let cards = scene.cards.slice()
  for (const token of turn.dismiss ?? []) {
    if (token === 'last') {
      cards = cards.slice(0, -1)
      continue
    }
    if (token.startsWith('type:')) {
      const type = token.slice(5)
      cards = cards.filter((card) => card.type !== type)
      continue
    }
    cards = cards.filter((card) => card.id !== token)
  }
  for (const card of turn.cards ?? []) {
    const index = cards.findIndex((item) => item.id === card.id)
    if (index >= 0) cards[index] = card
    else cards = [...cards, card]
  }
  return {
    ...scene,
    view: turn.view ?? scene.view,
    mood: turn.mood ?? scene.mood,
    lines: turn.lines ?? scene.lines,
    cards,
    speech: turn.speech,
    status: turn.status ?? (turn.speech ? 'talking' : 'idle'),
    language: turn.language ?? scene.language,
  }
}

export function markDueTimers(scene: Scene, now: number): Scene {
  let mood = scene.mood
  let view = scene.view
  let changed = false
  const cards: SceneCard[] = scene.cards.map((card) => {
    if (card.type !== 'timer' || card.alerted || card.endsAt == null || card.endsAt > now) return card
    changed = true
    mood = 'alert'
    view = 'timer'
    return { ...card, alerted: true }
  })
  if (!changed) return scene
  return {
    ...scene,
    cards,
    mood,
    view,
    lines: ['时间到了', cards.find((card) => card.alerted && card.type === 'timer')?.title ?? '看一下计时'],
    speech: scene.speech,
  }
}
