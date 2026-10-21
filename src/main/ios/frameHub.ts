import {
  createServer,
  get,
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse
} from 'http'

export type FrameListener = (frame: Buffer) => void

export interface IosFrameHub {
  port: number
  latestFrame: () => Buffer | null
  onFrame: (listener: FrameListener) => () => void
  onClose: (listener: () => void) => void
  close: () => void
}

const CONTENT_LENGTH = Buffer.from('Content-Length:')
const HEADER_END = Buffer.from('\r\n\r\n')
const RECONNECT_DELAY_MS = 800
const STALL_TIMEOUT_MS = 5000
const MAX_CLIENT_BACKLOG = 4 * 1024 * 1024

function writeFrame(response: ServerResponse, frame: Buffer): void {
  if (response.writableLength > MAX_CLIENT_BACKLOG) {
    return
  }
  response.write(`data:${frame.toString('base64')}\n\n`)
}

// go-ios declares `boundary=--BoundaryString` but writes `--BoundaryString`, so Chromium never
// finds a part delimiter and freezes on the first frame. The hub reads the (chunked) upstream
// with a real HTTP client, splits JPEGs by Content-Length and pushes each one to the window as a
// server-sent event, which draws it onto a canvas. The same frames feed recording.
export function startIosFrameHub(upstreamPort: number): Promise<IosFrameHub> {
  const clients = new Set<ServerResponse>()
  const frameListeners = new Set<FrameListener>()
  const closeListeners = new Set<() => void>()
  let lastFrame: Buffer | null = null
  let lastFrameAt = Date.now()
  let closed = false
  let generation = 0
  let request: ClientRequest | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const publish = (frame: Buffer): void => {
    lastFrame = frame
    lastFrameAt = Date.now()
    for (const client of clients) {
      writeFrame(client, frame)
    }
    for (const listener of frameListeners) {
      listener(frame)
    }
  }

  const scheduleReconnect = (id: number): void => {
    if (closed || (id !== generation) || retryTimer) {
      return
    }
    retryTimer = setTimeout(() => {
      retryTimer = null
      connectUpstream()
    }, RECONNECT_DELAY_MS)
  }

  const connectUpstream = (): void => {
    if (closed) {
      return
    }
    generation += 1
    const id = generation
    let buffer = Buffer.alloc(0)
    lastFrameAt = Date.now()

    request = get({ host: '127.0.0.1', port: upstreamPort, path: '/' }, (upstream: IncomingMessage) => {
      upstream.on('data', (chunk: Buffer) => {
        if (id !== generation) {
          return
        }
        buffer = Buffer.concat([buffer, chunk])
        while (true) {
          const lengthIndex = buffer.indexOf(CONTENT_LENGTH)
          if (lengthIndex < 0) {
            break
          }
          const headerEnd = buffer.indexOf(HEADER_END, lengthIndex)
          if (headerEnd < 0) {
            break
          }
          const length = Number.parseInt(
            buffer.subarray(lengthIndex + CONTENT_LENGTH.length, headerEnd).toString('ascii').trim(),
            10
          )
          const start = headerEnd + HEADER_END.length
          if (!Number.isFinite(length) || (buffer.length < start + length)) {
            break
          }
          publish(Buffer.from(buffer.subarray(start, start + length)))
          buffer = buffer.subarray(start + length)
        }
      })
      upstream.on('end', () => scheduleReconnect(id))
      upstream.on('error', () => scheduleReconnect(id))
    })
    request.on('error', () => scheduleReconnect(id))
  }

  const watchdog = setInterval(() => {
    if (!closed && (Date.now() - lastFrameAt > STALL_TIMEOUT_MS)) {
      const id = generation
      request?.destroy()
      scheduleReconnect(id)
    }
  }, 2000)

  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive'
    })
    clients.add(res)
    if (lastFrame) {
      writeFrame(res, lastFrame)
    }
    req.on('close', () => {
      clients.delete(res)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      connectUpstream()
      resolve({
        port,
        latestFrame: () => lastFrame,
        onFrame: (listener) => {
          frameListeners.add(listener)
          return () => {
            frameListeners.delete(listener)
          }
        },
        onClose: (listener) => {
          closeListeners.add(listener)
        },
        close: () => {
          if (closed) {
            return
          }
          closed = true
          clearInterval(watchdog)
          if (retryTimer) {
            clearTimeout(retryTimer)
          }
          request?.destroy()
          for (const client of clients) {
            client.destroy()
          }
          clients.clear()
          server.close()
          for (const listener of closeListeners) {
            listener()
          }
          closeListeners.clear()
          frameListeners.clear()
        }
      })
    })
  })
}
