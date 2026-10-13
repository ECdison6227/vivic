import { useCallback, useEffect, useState } from 'react'
import { emptyScene, type Scene } from './types.ts'

const KEY = 'vivic-scene-v1'
const CHANNEL = 'vivic-scene'

function readScene(): Scene {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyScene()
    return { ...emptyScene(), ...JSON.parse(raw) }
  } catch {
    return emptyScene()
  }
}

function publish(scene: Scene) {
  localStorage.setItem(KEY, JSON.stringify(scene))
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(scene)
  channel.close()
}

export function useScene() {
  const [scene, setScene] = useState<Scene>(readScene)

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL)
    const onMessage = (event: MessageEvent<Scene>) => {
      if (event.data?.view) setScene(event.data)
    }
    channel.addEventListener('message', onMessage)
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY && event.newValue) setScene({ ...emptyScene(), ...JSON.parse(event.newValue) })
    }
    window.addEventListener('storage', onStorage)
    return () => {
      channel.close()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const update = useCallback((recipe: (scene: Scene) => Scene) => {
    setScene((current) => {
      const next = recipe(current)
      if (next !== current) publish(next)
      return next
    })
  }, [])

  return [scene, update] as const
}
