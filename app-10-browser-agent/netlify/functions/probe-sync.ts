// TEMPORARY cut-off probe, do not merge.
export default async (req: Request) => {
  const n = Math.min(70, Math.max(1, Number(new URL(req.url).searchParams.get('n')) || 40))
  const startedAt = new Date().toISOString()
  await new Promise((r) => setTimeout(r, n * 1000))
  return Response.json({ waited: n, startedAt, endedAt: new Date().toISOString() })
}
