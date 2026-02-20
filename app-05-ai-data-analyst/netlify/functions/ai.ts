

interface RequestBody {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

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
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = (await req.json()) as RequestBody
    const { question, headers, sampleRows, rowCount } = body

    const schemaDescription = `Dataset with ${rowCount} rows.
Columns: ${headers.join(', ')}
Sample rows:
${JSON.stringify(sampleRows, null, 2)}`

    const systemPrompt = `You are a data analyst assistant. Given a dataset schema and sample data, generate a query plan to answer the user's question.

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "chartType": "bar" | "line" | "pie" | "area" | "scatter",
  "groupBy": "<column name to group by>",
  "aggregate": {
    "field": "<column name to aggregate>",
    "fn": "sum" | "avg" | "count" | "min" | "max"
  },
  "filter": {
    "field": "<column name>",
    "op": "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains",
    "value": "<string value>"
  },
  "sortBy": {
    "field": "<groupBy column or aggregate field name>",
    "dir": "asc" | "desc"
  },
  "title": "<descriptive chart title>",
  "explanation": "<brief explanation of what this visualization shows and why>"
}

Rules:
- "filter" and "sortBy" are optional — only include them if relevant
- groupBy and aggregate.field must be actual column names from the dataset
- For count queries, aggregate.field can be any column (count ignores the field value)
- Choose the most appropriate chartType for the data pattern`

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Dataset:\n${schemaDescription}\n\nQuestion: ${question}` },
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
      throw new Error('No text response from OpenRouter')
    }

    const text = rawText.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch || !jsonMatch[0]) {
      throw new Error('No JSON found in response')
    }

    const queryPlan = JSON.parse(jsonMatch[0])

    return new Response(JSON.stringify(queryPlan), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
}

export const config = { path: '/api/ai' }
