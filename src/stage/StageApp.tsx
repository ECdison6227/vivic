import { useEffect, useState, type ReactNode } from 'react'
import { CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react'
import AnimatedList from '@/components/AnimatedList'
import BlurText from '@/components/BlurText'
import BorderGlow from '@/components/BorderGlow'
import CountUp from '@/components/CountUp'
import Silk from '@/components/Silk'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Orb, type AgentState } from '@/components/ui/orb'
import { markDueTimers } from '../scene/apply.ts'
import { useScene } from '../scene/store.ts'
import { viewIds, type Mood, type Scene, type SceneCard, type ViewId } from '../scene/types.ts'

const silkMood: Record<Mood, { color: string; sheen: string; speed: number; noise: number; opacity: number; sheenAmt: number }> = {
  night: { color: '#121214', sheen: '#3c3c44', speed: 2.2, noise: 0.7, opacity: 0.7, sheenAmt: 0.16 },
  calm: { color: '#142824', sheen: '#6e8f86', speed: 3.4, noise: 1.05, opacity: 1, sheenAmt: 0.2 },
  focus: { color: '#14202e', sheen: '#6a86ad', speed: 4.2, noise: 1.15, opacity: 1, sheenAmt: 0.2 },
  alert: { color: '#2c1210', sheen: '#c45c4a', speed: 6.4, noise: 1.7, opacity: 1, sheenAmt: 0.32 },
  joy: { color: '#2c220f', sheen: '#c6a15b', speed: 4.5, noise: 1.25, opacity: 1, sheenAmt: 0.26 },
}

const orbMood: Record<Mood, [string, string]> = {
  night: ['#9eb4d4', '#e7eef8'],
  calm: ['#16332e', '#9dcebc'],
  focus: ['#17283d', '#9ebfe0'],
  alert: ['#3d1816', '#f0a090'],
  joy: ['#3a2c14', '#f0d092'],
}

export function StageApp() {
  const [scene, update] = useScene()

  useEffect(() => {
    const id = window.setInterval(() => {
      update((current) => markDueTimers(current, Date.now()))
    }, 1000)
    return () => window.clearInterval(id)
  }, [update])

  const silk = silkMood[scene.mood]
  const asleep = scene.view === 'idle' && scene.mood === 'night' && scene.status === 'idle'
  const index = Math.max(0, viewIds.indexOf(scene.view))

  return (
    <div className="stage-root dark relative h-full overflow-hidden bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
        style={{ opacity: asleep ? 0 : silk.opacity }}
      >
        <Silk
          color={silk.color}
          sheenColor={silk.sheen}
          sheen={0.04}
          glow={0}
          depth={0.75}
          speed={silk.speed}
          noiseIntensity={silk.noise}
          scale={1.15}
          fade={0.2}
          dpr={1.25}
          paused={asleep}
          mouseInteraction
        />
      </div>

      <div className="absolute inset-0 overflow-hidden">
        <div
          className="flex h-full"
          style={{
            transform: `translate3d(-${index * 100}vw, 0, 0)`,
            transition: 'transform 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {viewIds.map((view) => (
            <section key={view} className="flex h-full w-screen shrink-0 items-center px-[8vw]">
              <div className="w-full max-w-5xl">
                <ViewPane view={view} scene={scene} update={update} />
              </div>
            </section>
          ))}
        </div>
      </div>

      <div
        className={`pointer-events-none absolute transition-all duration-700 ${
          scene.view === 'idle'
            ? 'top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2'
            : 'right-10 bottom-10 h-28 w-28'
        }`}
      >
        <Orb
          className="h-full w-full"
          seed={7}
          colors={orbMood[scene.mood]}
          agentState={agentState(scene.status)}
        />
      </div>
    </div>
  )
}

function agentState(status: Scene['status']): AgentState {
  if (status === 'listening' || status === 'thinking' || status === 'talking') return status
  return null
}

function ViewPane({
  view,
  scene,
  update,
}: {
  view: ViewId
  scene: Scene
  update: (recipe: (scene: Scene) => Scene) => void
}) {
  const cards = scene.cards.filter((card) => card.type === viewFor(view))
  if (view === 'idle') return null
  if (view === 'lines') return <Lines lines={scene.lines} />
  if (view === 'now') return <Now cards={cards.length ? cards : scene.lines.map((line, index) => ({ id: `line-${index}`, type: 'now' as const, lines: [line] }))} />
  if (view === 'todo') return <Todos cards={cards} alert={scene.mood === 'alert'} update={update} />
  if (view === 'weather') return <Weather cards={cards} />
  if (view === 'timer') return <Timers cards={cards} alert={scene.mood === 'alert'} />
  if (view === 'glance' || view === 'reminder' || view === 'excerpt') {
    return <Texts cards={cards} alert={scene.mood === 'alert'} />
  }
  return null
}

function viewFor(view: ViewId): SceneCard['type'] | 'none' {
  if (view === 'idle' || view === 'lines') return 'none'
  return view
}

function Lines({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="flex flex-col gap-8">
      {lines.map((line, index) => (
        <BlurText
          key={`${index}-${line}`}
          text={line}
          animateBy="words"
          direction="top"
          delay={50}
          className={index === 0 ? 'text-7xl leading-tight font-medium text-white' : 'text-4xl leading-snug text-white/75'}
        />
      ))}
    </div>
  )
}

function Now({ cards }: { cards: SceneCard[] }) {
  const items = cards.flatMap((card) => card.lines ?? (card.text ? [card.text] : []))
  if (!items.length) return null
  return (
    <AnimatedList
      items={items.map((line) => ({ title: line }))}
      theme="dark"
      animation="pop"
      frame
      width="100%"
      maxHeight={560}
    />
  )
}

function Todos({
  cards,
  alert,
  update,
}: {
  cards: SceneCard[]
  alert: boolean
  update: (recipe: (scene: Scene) => Scene) => void
}) {
  if (!cards.length) return null
  return (
    <div className="flex flex-col gap-8">
      {cards.map((card) => (
        <Shell key={card.id} alert={alert}>
          {card.title ? <BlurText text={card.title} className="mb-4 text-4xl text-white" /> : null}
          <AnimatedList
            items={(card.items ?? []).map((item, index) => ({
              id: String(index),
              title: item.text,
              description: item.due,
              meta: item.done ? '1' : '',
            }))}
            theme="dark"
            animation="pop"
            frame
            width="100%"
            maxHeight={480}
            renderItem={(item) => {
              if (typeof item === 'string') return item
              const done = item.meta === '1'
              const index = Number(item.id)
              return (
                <span className="flex min-w-0 items-center gap-4">
                  <Checkbox
                    checked={done}
                    onCheckedChange={(value) => {
                      update((current) => ({
                        ...current,
                        cards: current.cards.map((entry) =>
                          entry.id === card.id
                            ? {
                                ...entry,
                                items: entry.items?.map((todo, todoIndex) =>
                                  todoIndex === index ? { ...todo, done: value === true } : todo,
                                ),
                              }
                            : entry,
                        ),
                      }))
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-lg">{item.title}</span>
                    {item.description ? <span className="text-sm text-white/60">{item.description}</span> : null}
                  </span>
                </span>
              )
            }}
          />
        </Shell>
      ))}
    </div>
  )
}

function Weather({ cards }: { cards: SceneCard[] }) {
  const card = cards[0]
  if (!card) return null
  const temp = Number.parseInt(card.temp ?? '0', 10)
  return (
    <Card className="border-white/10 bg-black/30 text-white backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-3xl font-medium">{card.city}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-8 pb-8">
        <div>
          <div className="flex items-end gap-2">
            <CountUp to={Number.isFinite(temp) ? temp : 0} className="text-8xl font-medium text-white" />
            <span className="pb-3 text-4xl text-white/80">°</span>
          </div>
          <BlurText text={card.condition ?? ''} className="mt-3 text-3xl text-white/80" />
          {card.text ? <p className="mt-3 text-xl text-white/60">{card.text}</p> : null}
        </div>
        <WeatherIcon condition={card.condition ?? ''} />
      </CardContent>
    </Card>
  )
}

function WeatherIcon({ condition }: { condition: string }) {
  const className = 'size-20 text-white/85'
  if (condition.includes('雷')) return <CloudLightning className={className} />
  if (condition.includes('雪')) return <CloudSnow className={className} />
  if (condition.includes('雨')) return <CloudRain className={className} />
  if (condition.includes('雾')) return <CloudFog className={className} />
  if (condition.includes('云')) return <CloudSun className={className} />
  return <Sun className={className} />
}

function Timers({ cards, alert }: { cards: SceneCard[]; alert: boolean }) {
  if (!cards.length) return null
  return (
    <div className="flex flex-col gap-8">
      {cards.map((card) => (
        <Shell key={card.id} alert={alert || Boolean(card.alerted)}>
          <div className="px-2 py-4">
            {card.endsAt ? <Remaining endsAt={card.endsAt} /> : null}
            {card.title ? <BlurText text={card.title} className="mt-4 text-4xl text-white/80" /> : null}
          </div>
        </Shell>
      ))}
    </div>
  )
}

function Remaining({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const left = Math.max(0, endsAt - now)
  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  return (
    <p className="text-8xl font-medium tracking-tight text-white tabular-nums">
      {minutes}:{String(seconds).padStart(2, '0')}
    </p>
  )
}

function Texts({ cards, alert }: { cards: SceneCard[]; alert: boolean }) {
  if (!cards.length) return null
  return (
    <div className="flex flex-col gap-8">
      {cards.map((card) => (
        <Shell key={card.id} alert={alert}>
          <BlurText text={card.text ?? card.title ?? ''} className="text-6xl leading-tight font-medium text-white" />
        </Shell>
      ))}
    </div>
  )
}

function Shell({ alert, children }: { alert: boolean; children: ReactNode }) {
  if (!alert) return <div>{children}</div>
  return (
    <BorderGlow glowColor="12 78% 62%" backgroundColor="rgb(28 12 12 / 42%)" borderRadius={28} className="p-8">
      {children}
    </BorderGlow>
  )
}
