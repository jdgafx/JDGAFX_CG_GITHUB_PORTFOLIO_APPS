// The curated picker options from app-06-picker.md. The server offers one only when the
// live catalogue still lists it (or, in fallback mode, as the only known set).
export interface CuratedGroup {
  label: string
  items: [id: string, why: string][]
}

export const CURATED_GROUPS: CuratedGroup[] = [
  {
    label: 'Speed and latency',
    items: [
      ['google/gemini-3.1-flash-lite', 'small and fast, long context'],
      ['openai/gpt-5.4-nano', 'smallest GPT-5.4 tier, quick replies'],
      ['google/gemini-2.5-flash-lite', 'low cost, quick'],
      ['qwen/qwen3.7-flash', 'very low price, quick'],
    ],
  },
  {
    label: 'Reasoning',
    items: [
      ['openai/gpt-5.5', 'strong multi-step reasoning'],
      ['anthropic/claude-opus-5.5', 'deep reasoning'],
      ['google/gemini-3.1-pro-preview', 'reasoning with 1M context'],
      ['deepseek/deepseek-v4-pro', 'low-cost reasoning model'],
      ['x-ai/grok-4.7', 'reasoning, large context'],
    ],
  },
  {
    label: 'Agentic and coding',
    items: [
      ['anthropic/claude-sonnet-5.5', 'strong tool use and coding'],
      ['openai/gpt-5.3-codex', 'tuned for coding agents'],
      ['qwen/qwen3-coder-next', 'coding, low price'],
      ['moonshotai/kimi-k2.6', 'agentic tool use'],
      ['z-ai/glm-5.1', 'agentic coding, low price'],
      ['mistralai/devstral-2512', 'coding agent'],
    ],
  },
  {
    label: 'Price and value',
    items: [
      ['deepseek/deepseek-v4-flash', 'low price per token'],
      ['openai/gpt-oss-120b', 'open-weight reasoning, cheap'],
      ['google/gemma-4-31b-it', 'low-cost open model'],
      ['qwen/qwen3.7-plus', 'capable, low cost'],
    ],
  },
  {
    label: 'Frontier quality',
    items: [
      ['anthropic/claude-sonnet-5', 'high quality, balanced'],
      ['openai/gpt-5.4', 'frontier general model'],
      ['google/gemini-3.5-flash', 'frontier speed and quality balance'],
      ['x-ai/grok-4.3', 'frontier, low output price'],
    ],
  },
]
