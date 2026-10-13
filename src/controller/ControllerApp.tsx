import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applyTurn } from '../scene/apply.ts'
import { useScene } from '../scene/store.ts'
import type { Language, Turn } from '../scene/types.ts'
import { useMic } from './useMic.ts'

type Devices = {
  devices: Array<{ uid: string; name: string }>
  selected: string
  activeName: string
}

const wakeKey = 'vivic-wake-word'

export function ControllerApp() {
  const [scene, update] = useScene()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [audio, setAudio] = useState<Devices | null>(null)
  const [wakeWord, setWakeWord] = useState(() => localStorage.getItem(wakeKey) || 'vivic')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(
    async (payload: { text?: string; imageBase64?: string }) => {
      const spoken = payload.text?.trim() ?? ''
      if (!spoken && !payload.imageBase64) return
      setBusy(true)
      setError('')
      update((current) => ({ ...current, status: 'thinking' }))
      try {
        const response = await fetch('/api/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: spoken,
            imageBase64: payload.imageBase64,
            language: scene.language,
            lines: scene.lines,
          }),
        })
        const turn = (await response.json()) as Turn & { error?: string }
        if (!response.ok || turn.error) throw new Error(turn.error || '没有完成')
        update((current) => applyTurn(current, turn))
        if (turn.speech) {
          update((current) => ({ ...current, status: 'talking' }))
          await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: turn.speech }),
          })
        }
        update((current) => ({ ...current, status: 'idle' }))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '没有完成')
        update((current) => ({ ...current, status: 'idle' }))
      } finally {
        setBusy(false)
      }
    },
    [scene.language, scene.lines, update],
  )

  const capture = useCallback(async () => {
    window.vivic?.setStageVisible(false)
    await new Promise((resolve) => window.setTimeout(resolve, 280))
    try {
      const response = await fetch('/api/capture', { method: 'POST' })
      const data = (await response.json()) as { imageBase64?: string; error?: string }
      if (!response.ok || !data.imageBase64) throw new Error(data.error || '没有截到屏幕')
      await submit({ text: '看看我现在的屏幕', imageBase64: data.imageBase64 })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有截到屏幕')
    } finally {
      window.vivic?.setStageVisible(true)
    }
  }, [submit])

  const { supported, hearing, holdStart, holdEnd } = useMic(wakeWord, (phrase) => {
    void submit({ text: phrase })
  })

  useEffect(() => {
    const alts = new Set<string>()
    let holding = false
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'AltLeft' || event.code === 'AltRight') {
        if (alts.has(event.code)) return
        alts.add(event.code)
        if (alts.size === 2) void capture()
      }
      if (event.code === 'MetaRight' && !holding) {
        holding = true
        holdStart()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      alts.delete(event.code)
      if (event.code === 'MetaRight' && holding) {
        holding = false
        holdEnd()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [capture, holdEnd, holdStart])

  useEffect(() => {
    const off = window.vivic?.onShortcut((name) => {
      if (name === 'talk-start') holdStart()
      if (name === 'talk-end') holdEnd()
      if (name === 'capture') void capture()
    })
    return () => off?.()
  }, [capture, holdEnd, holdStart])

  useEffect(() => {
    void fetch('/api/audio-devices')
      .then((response) => response.json())
      .then((data: Devices) => setAudio(data))
      .catch(() => setAudio(null))
  }, [])

  const hearingLabel = hearing === 'hold' ? '按住说话' : hearing === 'wake' ? `在听「${wakeWord}」` : '语音未开'

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs tracking-[0.22em] text-muted-foreground">VIVIC</p>
          <h1 className="text-2xl font-medium">电脑这边</h1>
        </div>
        <Badge variant="secondary">{statusLabel(scene.status)}</Badge>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const next = text
          setText('')
          void submit({ text: next })
        }}
      >
        <Input
          value={text}
          placeholder="打字跟 vivic 说"
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          发送
        </Button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span>{supported ? hearingLabel : '这台环境没有语音识别，可以打字'}</span>
        <a className="text-foreground underline-offset-4 hover:underline" href="/stage.html" target="vivic-stage">
          打开舞台
        </a>
      </div>

      <label className="grid gap-2 text-sm">
        唤醒词
        <Input
          value={wakeWord}
          onChange={(event) => {
            setWakeWord(event.target.value)
            localStorage.setItem(wakeKey, event.target.value)
          }}
        />
      </label>

      <label className="grid gap-2 text-sm">
        声音从这里播
        <select
          className="h-9 rounded-lg border border-input bg-transparent px-3"
          value={audio?.selected ?? 'auto'}
          onChange={(event) => {
            const uid = event.target.value
            setAudio((current) => (current ? { ...current, selected: uid } : current))
            void fetch('/api/audio-device', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uid }),
            }).then(() =>
              fetch('/api/audio-devices')
                .then((response) => response.json())
                .then((data: Devices) => setAudio(data)),
            )
          }}
        >
          <option value="auto">自动，优先电视</option>
          {audio?.devices.map((device) => (
            <option key={device.uid} value={device.uid}>
              {device.name}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">当前：{audio?.activeName ?? '还在找设备'}</span>
      </label>

      <div className="flex gap-2">
        {(['auto', 'zh', 'en'] as Language[]).map((language) => (
          <Button
            key={language}
            type="button"
            variant={scene.language === language ? 'default' : 'outline'}
            onClick={() => update((current) => ({ ...current, language }))}
          >
            {language === 'auto' ? '随用户' : language === 'zh' ? '中文' : 'English'}
          </Button>
        ))}
      </div>

      {scene.speech ? <p className="text-sm leading-6 text-muted-foreground">{scene.speech}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ul className="mt-auto space-y-1 text-xs leading-5 text-muted-foreground">
        <li>叫一声唤醒词，或按住右 Command 说话。</li>
        <li>左右 Option 同时按下，把工作屏幕截给 vivic。</li>
        <li>舞台窗口用乐播的窗口投屏送到电视。声音默认走电视，可以在上面改。</li>
      </ul>
    </main>
  )
}

function statusLabel(status: string) {
  if (status === 'listening') return '在听'
  if (status === 'thinking') return '在整理'
  if (status === 'talking') return '在说'
  return '待机'
}
