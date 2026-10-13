export {}

declare global {
  interface Window {
    vivic?: {
      onShortcut: (callback: (name: 'talk-start' | 'talk-end' | 'capture') => void) => () => void
      setStageVisible: (visible: boolean) => void
    }
  }
}
