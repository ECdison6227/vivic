import { useEffect, useRef, useState } from 'react'

type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechResult) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

type SpeechResult = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type SpeechCtor = new () => Rec

function ctor(): SpeechCtor | null {
  const host = window as Window & {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null
}

function escapeReg(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function useMic(wakeWord: string, onPhrase: (text: string) => void) {
  const onPhraseRef = useRef(onPhrase)
  const wakeRef = useRef(wakeWord)
  const modeRef = useRef<'wake' | 'hold' | 'stop'>('wake')
  const recRef = useRef<Rec | null>(null)
  const [supported, setSupported] = useState(false)
  const [hearing, setHearing] = useState<'off' | 'wake' | 'hold'>('off')

  useEffect(() => {
    onPhraseRef.current = onPhrase
  }, [onPhrase])

  useEffect(() => {
    wakeRef.current = wakeWord
  }, [wakeWord])

  useEffect(() => {
    const Speech = ctor()
    if (!Speech) return
    const rec = new Speech()
    rec.lang = 'zh-CN'
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index]?.isFinal) text += event.results[index]?.[0]?.transcript ?? ''
      }
      text = text.trim()
      if (!text) return
      if (modeRef.current === 'hold') {
        onPhraseRef.current(text)
        return
      }
      const wake = wakeRef.current.trim()
      if (!wake) return
      const match = text.match(new RegExp(escapeReg(wake), 'i'))
      if (!match || match.index == null) return
      const rest = text.slice(match.index + match[0].length).replace(/^[,，\s]+/, '')
      if (rest) onPhraseRef.current(rest)
    }
    rec.onerror = () => setHearing('off')
    rec.onend = () => {
      if (modeRef.current === 'stop') return
      window.setTimeout(() => {
        try {
          rec.start()
        } catch {
          setHearing('off')
        }
      }, 250)
    }
    recRef.current = rec
    setSupported(true)
    try {
      rec.start()
      setHearing('wake')
    } catch {
      setHearing('off')
    }
    return () => {
      modeRef.current = 'stop'
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  const holdStart = () => {
    modeRef.current = 'hold'
    setHearing('hold')
  }

  const holdEnd = () => {
    modeRef.current = 'wake'
    setHearing((current) => (current === 'off' ? 'off' : 'wake'))
  }

  return { supported, hearing, holdStart, holdEnd }
}
