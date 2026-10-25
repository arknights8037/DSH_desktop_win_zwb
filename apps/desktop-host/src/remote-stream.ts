/** Portless Remote streams with bounded, acknowledged Client-to-Host input. */
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'

/** Custom-protocol route for opening a logical Remote stream. */
export const DESKTOP_STREAM_PATH = '/.dsh/remote-stream'

/**
 * Open one stream using the selected kernel's Gateway API.
 * @param endpoint - Validated wire endpoint.
 * @param payload - Gateway-validated arguments.
 * @param signal - Stream lifetime, including response cancellation.
 * @param uplink - Client items, empty for a receive-only stream.
 * @returns Gateway output, including its readiness frame for event streams.
 */
export type OpenDesktopStream = (
  endpoint: string, payload: unknown, signal: AbortSignal, uplink: AsyncIterable<unknown>,
) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>

/**
 * Bridge Remote output and optional duplex input over instance-owned Fetch requests.
 * @param open - Kernel-specific Gateway invocation.
 * @returns Handler for the stream route and its `/input` subroute; writes acknowledge consumption.
 */
export function createDesktopStreamHandler(open: OpenDesktopStream): ConnectionFetchHandler {
  const inputs = new Map<string, { writer: WritableStreamDefaultWriter<unknown>; writing: boolean }>()
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      let body: unknown
      try { body = await request.json() }
      catch (_invalidJson) { return new Response('body is not JSON', { status: 400 }) }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return new Response('invalid stream request', { status: 400 })
      const input = body as Record<string, unknown>
      if (new URL(request.url).pathname === `${DESKTOP_STREAM_PATH}/input`) {
        if (typeof input.id !== 'string' || (input.end !== true && !Object.hasOwn(input, 'value'))) return new Response('invalid stream input', { status: 400 })
        const channel = inputs.get(input.id)
        if (!channel) return new Response('stream is closed', { status: 410 })
        if (channel.writing) return new Response('stream input is pending', { status: 409 })
        channel.writing = true
        try {
          if (input.end === true) await channel.writer.close()
          else await channel.writer.write(input.value)
          return new Response(null, { status: 204 })
        } catch (_closedStream) { return new Response('stream is closed', { status: 410 }) }
        finally { channel.writing = false }
      }
      if (typeof input.endpoint !== 'string' || (input.id !== undefined
        && (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(input.id)))) return new Response('invalid stream request', { status: 400 })
      const id = input.id
      if (id !== undefined && inputs.has(id)) return new Response('stream already exists', { status: 409 })
      const duplex = id === undefined ? undefined : new TransformStream<unknown, unknown>()
      const writer = duplex?.writable.getWriter()
      if (id !== undefined && writer !== undefined) inputs.set(id, { writer, writing: false })
      const controller = new AbortController()
      const signal = AbortSignal.any([request.signal, controller.signal])
      const abortInput = (): void => { void writer?.abort(signal.reason).catch(() => undefined) }
      signal.addEventListener('abort', abortInput, { once: true })
      if (signal.aborted) abortInput()
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(output) {
          try {
            const values = await open(input.endpoint as string, input.payload, signal,
              duplex?.readable ?? new ReadableStream<unknown>({ start(empty) { empty.close() } }))
            for await (const value of values) output.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
            output.close()
          } catch (error) { output.error(error) }
          finally {
            if (id !== undefined) inputs.delete(id)
            signal.removeEventListener('abort', abortInput)
            await writer?.abort(new Error('Desktop stream closed')).catch(() => undefined)
          }
        },
        cancel(reason) { controller.abort(reason) },
      })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
    },
  }
}

/** Browser transport injected before the kernel's client bootstrap. */
export const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  ownsHost:true,
  async *openStream(endpoint,payload,signal,uplink){
    const controller=new AbortController(),lifetime=AbortSignal.any([signal,controller.signal])
    const id=uplink===undefined?undefined:crypto.randomUUID()
    const response=await fetch(${JSON.stringify(DESKTOP_STREAM_PATH)},{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload,id}),signal:lifetime
    })
    if(!response.ok||response.body===null)throw new Error('desktop stream transport failed: HTTP '+response.status)
    let failure,reader=response.body.getReader()
    const pumping=(async()=>{
      if(uplink===undefined)return
      const iterator=uplink[Symbol.asyncIterator]()
      let stop
      const stopped=new Promise(resolve=>{stop=()=>resolve({done:true});lifetime.addEventListener('abort',stop,{once:true})})
      if(lifetime.aborted)stop()
      try{
        for(;;){
          const item=await Promise.race([iterator.next(),stopped])
          if(lifetime.aborted)return
          const sent=await fetch(${JSON.stringify(`${DESKTOP_STREAM_PATH}/input`)},{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify(item.done?{id,end:true}:{id,value:item.value}),signal:lifetime})
          if(!sent.ok)throw new Error('desktop stream input failed: HTTP '+sent.status)
          if(item.done)return
        }
      }finally{
        lifetime.removeEventListener('abort',stop)
        Promise.resolve(iterator.return?.()).catch(()=>{})
      }
    })().catch(error=>{if(!lifetime.aborted){failure=error;controller.abort(error)}})
    try{
      const decoder=new TextDecoder()
      let pending=''
      for(;;){
        const {done,value}=await reader.read()
        pending+=decoder.decode(value,{stream:!done})
        let newline
        while((newline=pending.indexOf('\\n'))!==-1){
          const line=pending.slice(0,newline);pending=pending.slice(newline+1)
          if(line!=='')yield JSON.parse(line)
        }
        if(done)break
      }
      if(pending!=='')yield JSON.parse(pending)
    }finally{
      controller.abort()
      await reader.cancel().catch(()=>{})
      await pumping
      if(failure)throw failure
    }
  }
}`
