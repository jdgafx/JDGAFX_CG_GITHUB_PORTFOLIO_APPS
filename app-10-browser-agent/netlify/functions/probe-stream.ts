// TEMPORARY cut-off probe, do not merge.
export default async (req: Request) => {
  const n = Math.min(70, Math.max(1, Number(new URL(req.url).searchParams.get('n')) || 40))
  const t0 = Date.now()
  const enc = new TextEncoder()
  const body = new ReadableStream({
    async start(c) {
      for (let i = 1; i <= n; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        c.enqueue(enc.encode(`${Math.round((Date.now() - t0) / 1000)}\n`))
      }
      c.enqueue(enc.encode('done\n'))
      c.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}
