

interface RequestBody {
  question: string
  chunks: string[]
  documentTitle: string
}

interface AiResponse {
  answer: string
  source_chunk_indices: number[]
  confidence: number
}

const SYSTEM_PROMPT = `You are DocMind, an intelligent document Q&A assistant. You answer questions based ONLY on the provided document chunks.

Rules:
- Answer using ONLY information explicitly found in the provided chunks
- If the chunks don't contain enough information to answer, clearly say so
- Never fabricate or infer information beyond what is in the chunks
- Be precise, clear, and cite which chunks contain the relevant information

Confidence scoring:
- 0.8–1.0: The chunks directly and clearly answer the question
- 0.5–0.79: Partial or indirect answer found in chunks
- 0.0–0.49: Limited or no relevant information in the provided chunks

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{"answer":"your detailed answer here","source_chunk_indices":[0,2,5],"confidence":0.85}

The source_chunk_indices must reference the exact [Chunk N] numbers from the provided text (0-based index N).`

function buildUserMessage(question: string, chunks: string[], documentTitle: string): string {
  return `Document: "${documentTitle}"

Document Chunks:
${chunks.join('\n\n')}

Question: ${question}

Respond with ONLY the JSON object.`
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1]
    if (inner !== undefined) return inner.trim()
  }
  const jsonStart = trimmed.indexOf('{')
  const jsonEnd = trimmed.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd !== -1) {
    return trimmed.slice(jsonStart, jsonEnd + 1)
  }
  return trimmed
}

export const config = { path: '/api/ai' }

export default async (req: Request): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as RequestBody
    const { question, chunks, documentTitle } = body

    if (!question || !chunks?.length || !documentTitle) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: question, chunks, documentTitle' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        max_tokens: 2048,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(question, chunks, documentTitle) },
        ],
      }),
    })

    if (!aiResponse.ok) {
      throw new Error(`OpenRouter error: ${aiResponse.status} ${aiResponse.statusText}`)
    }

    const aiData = (await aiResponse.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const rawText = aiData.choices[0]?.message?.content
    if (!rawText) {
      throw new Error('Unexpected response type from OpenRouter')
    }

    const jsonText = extractJson(rawText)
    const result = JSON.parse(jsonText) as AiResponse

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
}
