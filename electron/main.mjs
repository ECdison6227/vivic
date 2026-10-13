import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const devUrl = process.env.VIVIC_URL ?? 'http://127.0.0.1:5173'

/** @type {BrowserWindow | null} */
let stage = null
/** @type {BrowserWindow | null} */
let controller = null

function send(name) {
  controller?.webContents.send('shortcut', name)
}

function createWindows() {
  stage = new BrowserWindow({
    width: 1440,
    height: 810,
    title: 'Vivic Stage',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  controller = new BrowserWindow({
    width: 460,
    height: 760,
    title: 'Vivic',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  stage.loadURL(`${devUrl}/stage.html`)
  controller.loadURL(`${devUrl}/controller.html`)
}

const pressed = new Set()
let stopKeys = () => {}

async function watchKeys() {
  const { uIOhook, UiohookKey } = await import('uiohook-napi')
  uIOhook.on('keydown', (event) => {
    if (pressed.has(event.keycode)) return
    pressed.add(event.keycode)
    if (event.keycode === UiohookKey.MetaRight) send('talk-start')
    const bothAlts = pressed.has(UiohookKey.Alt) && pressed.has(UiohookKey.AltRight)
    if (bothAlts && (event.keycode === UiohookKey.Alt || event.keycode === UiohookKey.AltRight)) {
      send('capture')
    }
  })
  uIOhook.on('keyup', (event) => {
    pressed.delete(event.keycode)
    if (event.keycode === UiohookKey.MetaRight) send('talk-end')
  })
  uIOhook.start()
  stopKeys = () => uIOhook.stop()
}

app.whenReady().then(() => {
  createWindows()
  ipcMain.on('stage-visible', (_event, visible) => {
    if (!stage) return
    if (visible) stage.show()
    else stage.hide()
  })
  try {
    watchKeys().catch((error) => {
      console.error('全局按键没有挂上', error)
    })
  } catch (error) {
    console.error('全局按键没有挂上', error)
  }
})

app.on('window-all-closed', () => {
  stopKeys()
  app.quit()
})
