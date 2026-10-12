// The strict claim schema as spec section 3 (rev 7, N2, rev 8.3) writes it plus the Step 0.5 totals pattern (a positive count), independent of WP1's CLAIM_SCHEMA.
const DATE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

export function expectedSchema(names: string[]): object {
  const claim = (kinds: string[], valuePattern: string, dayPattern: string, spans = ['window', 'last30', 'none']) => ({
    type: 'object', additionalProperties: false, required: ['t', 'kind', 'package', 'span', 'day', 'value'],
    properties: {
      t: { type: 'string', enum: ['claim'] },
      kind: { type: 'string', enum: kinds },
      package: { type: 'string', enum: names },
      span: { type: 'string', enum: spans },
      day: { type: 'string', pattern: dayPattern },
      value: { type: 'string', pattern: valuePattern },
    },
  })
  return {
    type: 'object', additionalProperties: false, required: ['paragraph'],
    properties: {
      paragraph: {
        type: 'array',
        items: {
          anyOf: [
            { type: 'object', additionalProperties: false, required: ['t', 's'], properties: { t: { type: 'string', enum: ['text'] }, s: { type: 'string' } } },
            // Rev 8.3: a total and a window length need a span; the model wrote span none for a correct total (SP2 item 5).
            claim(['window_total', 'window_days'], '^[1-9][0-9]*$', '^$', ['window', 'last30']),
            claim(['peak_value'], '^[1-9][0-9]*$', '^$'),
            claim(['day_value'], '^[0-9]+$', DATE),
            claim(['peak_day', 'unusual_day', 'day'], DATE, '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
            claim(['change_pct'], '^$', '^$'),
            {
              type: 'object', additionalProperties: false, required: ['t', 'package', 'peer', 'metric'],
              properties: {
                t: { type: 'string', enum: ['compare'] },
                package: { type: 'string', enum: names },
                peer: { type: 'string', enum: names },
                metric: { type: 'string', enum: ['window_total', 'last30_total', 'change_pct', 'peak_value'] },
              },
            },
          ],
        },
      },
    },
  }
}
