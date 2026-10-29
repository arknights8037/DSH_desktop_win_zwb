import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { createDesktopStreamHandler, DESKTOP_STREAM_PATH, DESKTOP_TRANSPORT_SCRIPT } from '../../desktop-host/src/remote-stream.ts'

interface BrowserTransport {
  openStream(
    endpoint: string, payload: unknown, signal: AbortSignal, input?: AsyncIterable<unknown>,
  ): AsyncGenerator<unknown, undefined, unknown>
}

function request(path: string, body: unknown, signal?: AbortSignal): Request {
  return new Request(`dsh-app://app${path}`, { method: 'POST', body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }) })
}

it('acknowledges duplex input only after consumption and cancels pending input with the output', async () => {
  const consuming = Promise.withResolvers<undefined>()
  const blocked = Promise.withResolvers<undefined>()
  const id = randomUUID()
  let lifetime: AbortSignal | undefined
  const handler = createDesktopStreamHandler(async function* (_endpoint, _payload, signal, uplink) {
    lifetime = signal
    yield 'ready'
    await consuming.promise
    for await (const item of uplink) {
      yield item
      await blocked.promise
    }
  })
  const response = await handler.fetch(request(DESKTOP_STREAM_PATH, { endpoint: 'echo', payload: {}, id }))
  const reader = response.body!.getReader()
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('"ready"\n')
    let acknowledged = false
    const first = handler.fetch(request(`${DESKTOP_STREAM_PATH}/input`, { id, value: 1 })).then((result) => { acknowledged = true; return result })
    // Reading the second request's refusal observes that the first owns the pending write.
    expect((await handler.fetch(request(`${DESKTOP_STREAM_PATH}/input`, { id, value: 2 }))).status).toBe(409)
    expect(acknowledged).toBe(false)
    consuming.resolve(undefined)
    expect((await first).status).toBe(204)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('1\n')
    const pending = handler.fetch(request(`${DESKTOP_STREAM_PATH}/input`, { id, value: 3 }))
    await reader.cancel()
    expect((await pending).status).toBe(410)
    expect(lifetime?.aborted).toBe(true)
    blocked.resolve(undefined)
    await expect(handler.fetch(request(`${DESKTOP_STREAM_PATH}/input`, { id, value: 4 }))).resolves.toMatchObject({ status: 410 })
  } finally {
    consuming.resolve(undefined)
    blocked.resolve(undefined)
    await reader.cancel()
  }
})

it('carries browser duplex frames and completion through the real Fetch adapter', async () => {
  const handler = createDesktopStreamHandler(async function* (endpoint, payload, _signal, input) {
    expect(endpoint).toBe('echo')
    expect(payload).toEqual({ args: {} })
    yield 'ready'
    for await (const item of input) yield { echoed: item }
  })
  const runtime = {
    fetch: (path: string, init: RequestInit) => handler.fetch(new Request(`dsh-app://app${path}`, init)),
    AbortController, AbortSignal, TextDecoder, crypto: { randomUUID },
    __DSH_TRANSPORT__: undefined as BrowserTransport | undefined,
  }
  runInNewContext(DESKTOP_TRANSPORT_SCRIPT, runtime)
  const values: unknown[] = []
  for await (const value of runtime.__DSH_TRANSPORT__!.openStream('echo', { args: {} }, new AbortController().signal,
    (async function* () { yield 'first'; yield 'second' })())) values.push(value)
  expect(values).toEqual(['ready', { echoed: 'first' }, { echoed: 'second' }])
})

it('stops a browser input pump whose producer is waiting when its output is cancelled', async () => {
  const pending = Promise.withResolvers<IteratorResult<unknown>>()
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
  const input: AsyncIterable<unknown> = { [Symbol.asyncIterator]: () => ({ next: () => pending.promise, return: returned }) }
  const handler = createDesktopStreamHandler(async function* (_endpoint, _payload, _signal, uplink) {
    yield 'ready'
    for await (const item of uplink) yield item
  })
  const runtime = { fetch: (path: string, init: RequestInit) => handler.fetch(new Request(`dsh-app://app${path}`, init)),
    AbortController, AbortSignal, TextDecoder, crypto: { randomUUID }, __DSH_TRANSPORT__: undefined as BrowserTransport | undefined }
  runInNewContext(DESKTOP_TRANSPORT_SCRIPT, runtime)
  const output = runtime.__DSH_TRANSPORT__!.openStream('echo', {}, new AbortController().signal, input)
  try {
    expect((await output.next()).value).toBe('ready')
    await output.return(undefined)
    expect(returned).toHaveBeenCalledOnce()
  } finally { pending.resolve({ done: true, value: undefined }); await output.return(undefined) }
})

it('rejects malformed and expired stream requests', async () => {
  const handler = createDesktopStreamHandler(async function* () { yield* [] })
  expect((await handler.fetch(new Request(`dsh-app://app${DESKTOP_STREAM_PATH}`))).status).toBe(405)
  for (const body of [null, [], {}, { endpoint: 'echo', id: '../escape' }]) {
    expect((await handler.fetch(request(DESKTOP_STREAM_PATH, body))).status).toBe(400)
  }
  expect((await handler.fetch(request(`${DESKTOP_STREAM_PATH}/input`, { id: randomUUID(), value: 1 }))).status).toBe(410)
})
