import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { classify, replyLanguage } from '../scene/jev.ts'
import type { Language, SceneCard, Turn } from '../scene/types.ts'

const exec = promisify(execFile)

export type TurnRequest = {
  text?: string
  imageBase64?: string
  language?: Language
  lines?: string[]
  view?: string
}

type Settings = {
  audioUid: string
  city?: string
}

const root = process.cwd()
const settingsPath = path.join(root, '.vivic', 'settings.json')
const playerPath = path.join(root, 'native', 'vivic-play')

const textModels = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-v4-pro']
const visionModel = 'deepseek-v4-flash-vision-exp'

export async function runTurn(input: TurnRequest): Promise<Turn> {
  const text = input.text?.trim() ?? ''
  const language = input.language ?? 'auto'
  if (input.imageBase64) return askVision(input.imageBase64, text || '看看我现在的屏幕', language)
  const fast = classify(text)
  if (!fast) return askModel(text, language, input.lines ?? [])
  if (fast.kind === 'turn') return fast.turn
  if (fast.kind === 'timer') return timerTurn(fast.minutes, fast.label, language)
  if (fast.kind === 'weather') return weatherTurn(fast.city, language)
  return searchTurn(fast.query, language)
}

function timerTurn(minutes: number, label: string, language: Language): Turn {
  const endsAt = Date.now() + minutes * 60_000
  const title = label || (language === 'en' ? 'Time' : '到点了')
  const card: SceneCard = { id: `timer:${title}`, type: 'timer', title, endsAt }
  if (language === 'en') {
    return {
      speech: `Okay. I'll remind you in ${minutes} minutes: ${title}.`,
      lines: [`${minutes} min`, title],
      cards: [card],
      view: 'timer',
      mood: 'focus',
      status: 'talking',
    }
  }
  return {
    speech: `好，${minutes} 分钟后提醒你${title}。`,
    lines: [`${minutes} 分钟`, title],
    cards: [card],
    view: 'timer',
    mood: 'focus',
    status: 'talking',
  }
}

async function weatherTurn(city: string | undefined, language: Language): Promise<Turn> {
  const settings = await readSettings()
  const place = city || settings.city || (await locateCity()) || '成都'
  if (!settings.city) await writeSettings({ ...settings, city: place })
  try {
    const forecast = await fetchWeather(place)
    const card: SceneCard = {
      id: `weather:${place}`,
      type: 'weather',
      city: place,
      temp: `${Math.round(forecast.temp)}°`,
      condition: forecast.condition,
      text: forecast.range,
    }
    const lines = [`${place} ${card.temp}`, forecast.condition, forecast.range]
    const speech =
      language === 'en'
        ? `${place} is ${card.temp} and ${forecast.condition}. ${forecast.range}.`
        : `${place}现在 ${card.temp}，${forecast.condition}。${forecast.range}。`
    return { speech, lines, cards: [card], view: 'weather', mood: 'calm', status: 'talking' }
  } catch {
    return {
      speech: language === 'en' ? "I couldn't get the weather." : '天气没有拿到。',
      lines: language === 'en' ? ['Weather unavailable'] : ['天气没拿到'],
      view: 'lines',
      mood: 'night',
      status: 'talking',
    }
  }
}

async function searchTurn(query: string, language: Language): Promise<Turn> {
  let notes = ''
  try {
    notes = await tavilySearch(query)
  } catch {
    notes = '搜索没有返回结果。'
  }
  return askModel(query, language, [], notes)
}

async function askModel(text: string, language: Language, lines: string[], notes = ''): Promise<Turn> {
  const lang = replyLanguage(text, language)
  const system = systemPrompt(lang)
  const user = [
    lines.length ? `屏幕上正在显示：${lines.join(' / ')}` : '',
    notes ? `检索材料：\n${notes}` : '',
    `用户说：${text}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const content = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    textModels,
  )
  return normalize(content, lang)
}

async function askVision(imageBase64: string, text: string, language: Language): Promise<Turn> {
  const lang = replyLanguage(text, language)
  const content = await chat(
    [
      { role: 'system', content: systemPrompt(lang) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `这是用户当前工作屏幕的截图。${text}\n抓住他正在做的事，屏幕只留要点。` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
        ],
      },
    ],
    [visionModel],
  )
  const turn = normalize(content, lang)
  return {
    ...turn,
    view: turn.view ?? 'glance',
    cards: turn.cards?.length
      ? turn.cards
      : [{ id: 'glance:latest', type: 'glance', text: turn.lines?.[0] ?? turn.speech }],
  }
}

function systemPrompt(language: 'zh' | 'en') {
  return `你是 vivic，投在电视上的语音助手。只输出 JSON，不要 markdown。
屏幕和嘴里说的可以不一样：lines 是电视上的台词，短，1 到 4 行，每行不超过 16 个字；speech 是说出来的话，可以更完整，但仍然口语。
这次用${language === 'en' ? '英文' : '中文'}。
mood 只能是 night、calm、focus、alert、joy。
view 只能是 idle、lines、now、todo、weather、glance、timer、reminder、excerpt。
cards 没有就给空数组。card.type 只能是 todo、weather、timer、excerpt、reminder、glance、now。
示例：{"speech":"先把今晚要做的三件事留下。","lines":["先写投屏","再核对声音","功能先不扩张"],"mood":"focus","view":"lines","cards":[]}`
}

async function chat(
  messages: Array<{ role: string; content: unknown }>,
  models: string[],
): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('缺少 DEEPSEEK_API_KEY')
  let last = '模型没有返回'
  for (const model of models) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 900,
        temperature: 0.4,
      }),
    })
    if (!response.ok) {
      const body = await response.text()
      last = response.status === 401 || body.includes('Authentication') ? '模型密钥没有通过' : `模型没有接上（${response.status}）`
      continue
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (content) return content
  }
  throw new Error(last.slice(0, 240))
}

export function normalize(raw: string, language: Language): Turn {
  const parsed = JSON.parse(stripFence(raw)) as Partial<Turn>
  const lines = Array.isArray(parsed.lines)
    ? parsed.lines.filter((line) => typeof line === 'string').map((line) => line.trim()).filter(Boolean).slice(0, 4)
    : []
  const cards = Array.isArray(parsed.cards) ? parsed.cards.filter(isCard).slice(0, 6) : []
  return {
    speech: typeof parsed.speech === 'string' ? parsed.speech.trim() : lines.join('。'),
    lines,
    mood: parsed.mood,
    view: parsed.view,
    cards,
    language,
    status: 'talking',
  }
}

function stripFence(raw: string) {
  return raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
}

function isCard(value: unknown): value is SceneCard {
  if (!value || typeof value !== 'object') return false
  const card = value as SceneCard
  return typeof card.id === 'string' && typeof card.type === 'string'
}

async function tavilySearch(query: string) {
  const key = process.env.TAVILY_API_KEY
  if (!key) throw new Error('缺少 TAVILY_API_KEY')
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: true,
      search_depth: 'basic',
    }),
  })
  if (!response.ok) throw new Error(`搜索失败 ${response.status}`)
  const data = (await response.json()) as {
    answer?: string
    results?: Array<{ title?: string; content?: string }>
  }
  const bits = [
    data.answer,
    ...(data.results ?? []).slice(0, 4).map((item) => `${item.title ?? ''}：${item.content ?? ''}`),
  ].filter(Boolean)
  return bits.join('\n').slice(0, 4000)
}

type Forecast = { temp: number; condition: string; range: string }

async function fetchWeather(city: string): Promise<Forecast> {
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`,
  )
  if (!geo.ok) throw new Error('geo')
  const found = (await geo.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
  const hit = found.results?.[0]
  if (!hit) throw new Error('city')
  const forecast = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
  )
  if (!forecast.ok) throw new Error('forecast')
  const data = (await forecast.json()) as {
    current?: { temperature_2m?: number; weather_code?: number }
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] }
  }
  const temp = data.current?.temperature_2m ?? 0
  const code = data.current?.weather_code ?? 0
  const high = data.daily?.temperature_2m_max?.[0]
  const low = data.daily?.temperature_2m_min?.[0]
  const range =
    high != null && low != null ? `${Math.round(low)}° 到 ${Math.round(high)}°` : ''
  return { temp, condition: weatherText(code), range }
}

function weatherText(code: number) {
  if (code === 0) return '晴'
  if (code <= 3) return '多云'
  if (code <= 48) return '有雾'
  if (code <= 67) return '下雨'
  if (code <= 77) return '下雪'
  if (code <= 82) return '阵雨'
  if (code <= 86) return '阵雪'
  return '有雷雨'
}

async function locateCity() {
  try {
    const response = await fetch('https://get.geojs.io/v1/ip/geo.json')
    if (!response.ok) return undefined
    const data = (await response.json()) as { city?: string }
    return data.city
  } catch {
    return undefined
  }
}

export async function readSettings(): Promise<Settings> {
  try {
    return { audioUid: 'auto', ...JSON.parse(await readFile(settingsPath, 'utf8')) }
  } catch {
    return { audioUid: 'auto' }
  }
}

export async function writeSettings(settings: Settings) {
  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2))
}

export type AudioDevice = { uid: string; name: string; id: number; isDefault: boolean }

export async function listAudioDevices(): Promise<AudioDevice[]> {
  try {
    const { stdout } = await exec(playerPath, ['list'])
    return JSON.parse(stdout) as AudioDevice[]
  } catch {
    return []
  }
}

const tvName = /电视|tv|airplay|lebo|乐播|hpplay|homepod|hdmi|小米|xiaomi|sony|lg\b|tcl|hisense|海信|创维|投影|projector/i

export function pickDevice(devices: AudioDevice[], audioUid: string) {
  if (audioUid !== 'auto') return devices.find((device) => device.uid === audioUid) ?? devices.find((device) => device.isDefault)
  return devices.find((device) => tvName.test(device.name)) ?? devices.find((device) => device.isDefault) ?? devices[0]
}

let voiceName: string | undefined

async function chineseVoice() {
  if (voiceName) return voiceName
  try {
    const { stdout } = await exec('say', ['-v', '?'])
    const line = stdout.split('\n').find((item) => item.includes('zh_CN') || item.includes('zh_TW'))
    voiceName = line?.trim().split(/\s+/)[0] || 'Tingting'
  } catch {
    voiceName = 'Tingting'
  }
  return voiceName
}

export async function speak(text: string) {
  const spoken = text.trim()
  if (!spoken) return { device: '' }
  const file = path.join(tmpdir(), `vivic-speech-${Date.now()}.aiff`)
  const voice = await chineseVoice()
  await exec('say', ['-v', voice, '-r', '168', '-o', file, spoken.slice(0, 800)])
  const devices = await listAudioDevices()
  const settings = await readSettings()
  const device = pickDevice(devices, settings.audioUid)
  try {
    if (device) await exec(playerPath, ['--uid', device.uid, file])
    else await exec(playerPath, [file])
  } catch {
    await exec('afplay', [file])
  }
  return { device: device?.name ?? '系统默认' }
}
