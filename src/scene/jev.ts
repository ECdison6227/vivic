import type { Language, Mood, Turn, ViewId } from './types.ts'

export type FastPath =
  | { kind: 'turn'; turn: Turn }
  | { kind: 'weather'; city?: string }
  | { kind: 'search'; query: string }
  | { kind: 'timer'; minutes: number; label: string }
  | null

const views: Record<string, ViewId> = {
  眼睛: 'idle',
  待机: 'idle',
  台词: 'lines',
  此刻: 'now',
  待办: 'todo',
  天气: 'weather',
  屏幕: 'glance',
  计时: 'timer',
  提醒: 'reminder',
  摘录: 'excerpt',
}

const digit = '零一二三四五六七八九'

export function parseChineseNumber(raw: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  if (raw === '半') return 0.5
  if (raw === '十') return 10
  const ten = raw.indexOf('十')
  if (ten >= 0) {
    const left = ten === 0 ? 1 : digit.indexOf(raw[0] ?? '')
    const right = ten === raw.length - 1 ? 0 : digit.indexOf(raw[ten + 1] ?? '')
    if (left >= 0 && right >= 0) return left * 10 + right
  }
  if (raw.length === 1) {
    const value = digit.indexOf(raw)
    if (value > 0) return value
  }
  return null
}

export function extractCity(text: string): string | undefined {
  const match = text.match(/([\u4e00-\u9fff]{2,8}?)(?:今天|现在|今日|今晚)?的?天气/)
  if (!match?.[1]) return undefined
  const city = match[1].replace(/^(帮我看|我想看|请问|帮我|给我|看看|查询)/, '')
  if (city.length < 2) return undefined
  if (/^(现在|今天|今晚|今日|一下|这里)$/.test(city)) return undefined
  return city
}

function compact(text: string) {
  return text.trim().replace(/\s+/g, '')
}

export function classify(text: string): FastPath {
  const raw = text.trim()
  const folded = compact(raw)
  if (!folded) return null

  if (/^(用英文|switchtoenglish|englishplease)$/i.test(folded)) {
    return {
      kind: 'turn',
      turn: {
        speech: "I'll use English from here.",
        lines: ['English from here'],
        language: 'en',
        mood: 'calm',
        view: 'lines',
      },
    }
  }
  if (/^(用中文|说中文|中文回复)$/.test(folded)) {
    return {
      kind: 'turn',
      turn: {
        speech: '好，之后用中文说。',
        lines: ['之后用中文'],
        language: 'zh',
        mood: 'calm',
        view: 'lines',
      },
    }
  }

  if (/^(回眼睛|回去|回待机|待机)$/.test(folded)) {
    return { kind: 'turn', turn: { speech: '我在。', lines: [], view: 'idle', mood: 'night', status: 'idle' } }
  }

  const nav = folded.match(/^(?:去|打开|看看|切到)(眼睛|待机|台词|此刻|待办|天气|屏幕|计时|提醒|摘录)$/)
  if (nav?.[1] && views[nav[1]]) {
    const view = views[nav[1]]
    return {
      kind: 'turn',
      turn: {
        speech: '',
        view,
        status: 'idle',
      },
    }
  }

  if (/变红|换成红|红一点|背景红/.test(folded) && folded.length <= 16) {
    return moodTurn('alert', '换成提醒的颜色了。', ['背景转红'])
  }
  if (/变蓝|换成蓝|蓝一点/.test(folded) && folded.length <= 16) {
    return moodTurn('focus', '换成冷静的蓝色了。', ['背景转蓝'])
  }
  if (/变绿|安静一点|沉下去|暗下来|变黑/.test(folded) && folded.length <= 16) {
    return moodTurn('calm', '安静下来了。', ['背景沉下去'])
  }
  if (/开心|亮一点|换成金|变金/.test(folded) && folded.length <= 16) {
    return moodTurn('joy', '亮一点。', ['背景暖了'])
  }

  if (/^(关掉|去掉|关闭)天气$/.test(folded)) {
    return { kind: 'turn', turn: { speech: '天气拿掉了。', lines: ['天气已拿掉'], dismiss: ['type:weather'], status: 'idle' } }
  }
  if (/^(关掉|去掉|关闭)待办$/.test(folded)) {
    return { kind: 'turn', turn: { speech: '待办拿掉了。', lines: ['待办已拿掉'], dismiss: ['type:todo'], status: 'idle' } }
  }
  if (/^(去掉这个|关掉这个|拿掉这个)$/.test(folded)) {
    return { kind: 'turn', turn: { speech: '拿掉了。', dismiss: ['last'], status: 'idle' } }
  }

  const timer = parseTimer(raw)
  if (timer) return { kind: 'timer', ...timer }

  if (/天气/.test(folded) && !/^(去|打开)天气$/.test(folded)) {
    return { kind: 'weather', city: extractCity(raw) }
  }

  if (/搜索|搜一下|查一下|查查|搜集|帮我找|帮我查|了解一下/.test(folded)) {
    return { kind: 'search', query: raw }
  }

  return null
}

function moodTurn(mood: Mood, speech: string, lines: string[]): FastPath {
  return { kind: 'turn', turn: { speech, lines, mood, view: 'lines', status: 'talking' } }
}

export function parseTimer(text: string): { minutes: number; label: string } | null {
  const match = text.match(/([0-9]+(?:\.[0-9]+)?|[零一二三四五六七八九十两半]+)\s*(分钟|分|小时)/)
  if (!match?.[1] || !match[2]) return null
  if (!/提醒|计时|倒计时|后/.test(text)) return null
  const amount = parseChineseNumber(match[1].replace('两', '二'))
  if (amount == null) return null
  const minutes = match[2] === '小时' ? amount * 60 : amount
  if (minutes <= 0 || minutes > 24 * 60) return null
  const label = text
    .replace(match[0], '')
    .replace(/提醒我|记得|一下|后|的时候|叫我/g, '')
    .trim() || '到点了'
  return { minutes, label }
}

export function replyLanguage(text: string, current: Language): 'zh' | 'en' {
  if (current === 'zh' || current === 'en') return current
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  return latin > han ? 'en' : 'zh'
}
