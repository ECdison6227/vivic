import dotenv from 'dotenv'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'
import {
  listAudioDevices,
  pickDevice,
  readSettings,
  runTurn,
  speak,
  writeSettings,
} from '../src/agent/turn.ts'

dotenv.config({ path: path.join(process.cwd(), '.env') })

const exec = promisify(execFile)

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 12_000_000) throw new Error('请求太大')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

function send(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function vivicApi(): Plugin {
  return {
    name: 'vivic-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split('?')[0]
        if (!url?.startsWith('/api/')) return next()
        try {
          if (request.method === 'POST' && url === '/api/turn') {
            const body = await readBody(request)
            const turn = await runTurn({
              text: typeof body.text === 'string' ? body.text : '',
              imageBase64: typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined,
              language: body.language === 'zh' || body.language === 'en' || body.language === 'auto' ? body.language : 'auto',
              lines: Array.isArray(body.lines) ? body.lines.filter((line) => typeof line === 'string') : [],
            })
            return send(response, 200, turn)
          }
          if (request.method === 'POST' && url === '/api/speak') {
            const body = await readBody(request)
            const result = await speak(typeof body.text === 'string' ? body.text : '')
            return send(response, 200, result)
          }
          if (request.method === 'GET' && url === '/api/audio-devices') {
            const devices = await listAudioDevices()
            const settings = await readSettings()
            const active = pickDevice(devices, settings.audioUid)
            return send(response, 200, { devices, selected: settings.audioUid, activeName: active?.name ?? '系统默认' })
          }
          if (request.method === 'POST' && url === '/api/audio-device') {
            const body = await readBody(request)
            const settings = await readSettings()
            const audioUid = typeof body.uid === 'string' ? body.uid : 'auto'
            await writeSettings({ ...settings, audioUid })
            return send(response, 200, { ok: true })
          }
          if (request.method === 'POST' && url === '/api/capture') {
            const file = path.join(tmpdir(), `vivic-shot-${Date.now()}.jpg`)
            await exec('screencapture', ['-x', '-t', 'jpg', file])
            await exec('sips', ['-Z', '1280', file])
            const imageBase64 = (await readFile(file)).toString('base64')
            await rm(file, { force: true })
            return send(response, 200, { imageBase64 })
          }
          return send(response, 404, { error: '没有这个接口' })
        } catch (error) {
          const message = error instanceof Error ? error.message : '没有完成'
          return send(response, 500, { error: message })
        }
      })
    },
  }
}
