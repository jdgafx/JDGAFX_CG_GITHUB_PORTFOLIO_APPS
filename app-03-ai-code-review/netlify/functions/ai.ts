

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body = (await req.json()) as { code?: unknown; language?: unknown }
    const { code, language } = body

    if (!code || typeof code !== 'string') {
      return Response.json({ success: false, error: 'Code is required' }, { status: 400 })
    }

    const lang = typeof language === 'string' ? language : 'code'

    const systemPrompt = `You are an expert code reviewer. Analyze the provided ${lang} and return a JSON object with structured feedback.

Your response MUST be valid JSON with this exact structure:
{
  "comments": [
    {
      "line": <integer>,
      "severity": "<critical|warning|info>",
      "message": "<brief description of the issue>",
      "suggestion": "<specific improvement suggestion>"
    }
  ]
}

Severity guidelines:
- critical: Security vulnerabilities, bugs that cause errors, data loss risks
- warning: Performance issues, deprecated patterns, potential bugs, code smells
- info: Style suggestions, best practices, refactoring opportunities

Provide 3-8 meaningful comments. Focus on real issues. Return ONLY valid JSON, no markdown, no explanation.`

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
          { role: 'user', content: `Review this ${lang}:\n\n\`\`\`${lang}\n${code}\n\`\`\`` },
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

    const reviewData = JSON.parse(rawText) as { comments: unknown[] }
    return Response.json({ success: true, data: reviewData })
  } catch (error) {
    console.error('Review error:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}

export const config = {
  path: '/api/ai',
}
