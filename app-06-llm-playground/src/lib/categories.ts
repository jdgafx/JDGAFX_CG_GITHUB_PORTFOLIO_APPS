// Plain-language reasons for the model picker's groups. The server sends each group's label and
// its models. The reasons live here, so the picker can say why a model sits in its group.
const GROUP_REASONS: Partial<Record<string, string>> = {
  'Speed and latency': 'Small models that answer quickly and cost little.',
  Reasoning: 'Models built to work through multi-step problems before they answer.',
  'Agentic and coding': 'Models that call tools and write code for agent-style tasks.',
  'Price and value': 'Capable models with a low price per token.',
  'Frontier quality': 'Top general models, chosen for answer quality rather than price.',
  'All other live text models': 'Other text models from the live list, with at least 32,000 tokens of context.',
}

const UNKNOWN_GROUP = 'A text model from the model list.'

// The reason a picker group is there. A label this page does not know still gets a sentence.
export function groupReason(label: string): string {
  return GROUP_REASONS[label] ?? UNKNOWN_GROUP
}
