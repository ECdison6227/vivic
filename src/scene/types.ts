export const viewIds = [
  'idle',
  'lines',
  'now',
  'todo',
  'weather',
  'glance',
  'timer',
  'reminder',
  'excerpt',
] as const

export type ViewId = (typeof viewIds)[number]

export const moods = ['night', 'calm', 'focus', 'alert', 'joy'] as const

export type Mood = (typeof moods)[number]

export type Language = 'auto' | 'zh' | 'en'

export type AgentStatus = 'idle' | 'listening' | 'thinking' | 'talking'

export type TodoItem = {
  text: string
  due?: string
  done?: boolean
}

export type CardType = 'todo' | 'weather' | 'timer' | 'excerpt' | 'reminder' | 'glance' | 'now'

export type SceneCard = {
  id: string
  type: CardType
  title?: string
  text?: string
  lines?: string[]
  items?: TodoItem[]
  city?: string
  temp?: string
  condition?: string
  endsAt?: number
  alerted?: boolean
}

export type Scene = {
  view: ViewId
  mood: Mood
  lines: string[]
  cards: SceneCard[]
  status: AgentStatus
  speech: string
  language: Language
}

export type Turn = {
  speech: string
  lines?: string[]
  mood?: Mood
  view?: ViewId
  cards?: SceneCard[]
  dismiss?: string[]
  status?: AgentStatus
  language?: Language
}

export const emptyScene = (): Scene => ({
  view: 'idle',
  mood: 'night',
  lines: [],
  cards: [],
  status: 'idle',
  speech: '',
  language: 'auto',
})
