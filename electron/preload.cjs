const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vivic', {
  onShortcut(callback) {
    const listener = (_event, name) => callback(name)
    ipcRenderer.on('shortcut', listener)
    return () => ipcRenderer.removeListener('shortcut', listener)
  },
  setStageVisible(visible) {
    ipcRenderer.send('stage-visible', visible)
  },
})
