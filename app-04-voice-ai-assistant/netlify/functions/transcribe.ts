export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
  }

  let body: { audio: string; mimeType?: string }
  try {
    body = (await req.json()) as { audio: string; mimeType?: string }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.audio) {
    return Response.json({ error: 'Missing audio field' }, { status: 400 })
  }

  const audioBuffer = Buffer.from(body.audio, 'base64')
  const mimeType = body.mimeType ?? 'audio/webm'
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  const filename = `audio.${ext}`

  const formData = new FormData()
  const blob = new Blob([audioBuffer], { type: mimeType })
  formData.append('file', blob, filename)
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('response_format', 'json')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text()
    return Response.json({ error: `Groq API error: ${errText}` }, { status: response.status })
  }

  const data = (await response.json()) as { text: string }
  return Response.json({ text: data.text })
}

export const config = {
  path: '/api/transcribe',
}
