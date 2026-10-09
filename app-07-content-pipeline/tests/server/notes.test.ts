import { describe, expect, it } from 'vitest'
import handler from '../../netlify/functions/ai'
import { ARTICLE, CUT_OFF_MESSAGE, NOTES, completion, providerWill, request, stageBody, installFunctionHarness, type ErrorBody, type StageBody } from './harness'

installFunctionHarness()

describe('change notes from Edit and Polish', () => {
  const DRAFT = 'Rust began in 2006 with a small team of engineers. Mozilla sponsored the work from 2009 onward. The language guarantees memory safety without any garbage collector in the runtime.'
  const EDITED = 'Rust began in 2006 as a side project. Mozilla sponsored the work from 2009 onward. The language provides memory safety with no garbage collector in the runtime.'
  const NOTES_BLOCK = [
    '---CHANGES---',
    '- Added the origin of the project :: as a side project',
    '- Softened the strong claim :: guarantees memory safety without',
    '- Claimed a rewrite that never happened :: a completely new opening',
    '- Kept the sponsor line tidy :: Mozilla sponsored the work',
  ].join('\n')
  const context = { research: NOTES, outline: '- P', draft: DRAFT }

  it('returns the text without the notes, keeps the notes that match a real change, and says how many in the trace', async () => {
    providerWill(() => completion(`${EDITED}\n\n${NOTES_BLOCK}`))
    const res = await handler(request(stageBody('edit', context)))
    expect(res.status).toBe(200)
    const body = (await res.json()) as StageBody & { notes: Array<{ text: string; passage: string; side: string }> }
    expect(body.result).toBe(EDITED)
    expect(body.notes).toEqual([
      { text: 'Added the origin of the project', passage: 'as a side project', side: 'new' },
      { text: 'Softened the strong claim', passage: 'guarantees memory safety without', side: 'old' },
    ])
    expect(String(body.trace[0].detail)).toMatch(/^2 of 4 change notes kept\. \d+ words: /)
  })

  it('sends a note-shaped request: room for the notes and the delimiter in the prompt', async () => {
    const sent = providerWill(() => completion(EDITED))
    await handler(request(stageBody('edit', context)))
    expect((sent[0].body.messages as Array<{ content: string }>)[0].content).toContain('---CHANGES---')
    expect(sent[0].body.max_tokens).toBe(1020)
  })

  it('keeps the text and returns no notes when the reply has no notes section', async () => {
    providerWill(() => completion(EDITED))
    const body = (await (await handler(request(stageBody('edit', context)))).json()) as StageBody & { notes: unknown[] }
    expect(body.result).toBe(EDITED)
    expect(body.notes).toEqual([])
    expect(String(body.trace[0].detail)).toMatch(/^No change notes came back\. /)
  })

  it('accepts a reply cut off inside the notes, because the text before them is whole', async () => {
    providerWill(() => completion(`${EDITED}\n\n---CHANGES---\n- Added the origin of the project :: as a si`, { choices: [{ message: { content: `${EDITED}\n\n---CHANGES---\n- Added the origin of the project :: as a si` }, finish_reason: 'length' }] }))
    const res = await handler(request(stageBody('edit', context)))
    expect(res.status).toBe(200)
    expect(((await res.json()) as StageBody).result).toBe(EDITED)
  })

  it('still refuses a reply cut off before any notes section', async () => {
    providerWill(() => completion(EDITED, { choices: [{ message: { content: EDITED }, finish_reason: 'length' }] }))
    const res = await handler(request(stageBody('edit', context)))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: CUT_OFF_MESSAGE })
  })

  it('judges the length rule on the text alone, not on text plus notes', async () => {
    const tooShort = 'Rust began in 2006. Mozilla sponsored it.'
    providerWill(() => completion(`${tooShort}\n${NOTES_BLOCK}`))
    const res = await handler(request(stageBody('edit', context)))
    expect(res.status).toBe(502)
    expect(((await res.json()) as ErrorBody).error).toMatch(/far less text than the Draft stage/)
  })

  it('checks Polish notes against the piece without its appended Sources list', async () => {
    const polished = 'Rust began in 2006 as a side project at Mozilla. Mozilla sponsored the work from 2009 onward. The language provides memory safety with no garbage collector in the runtime.'
    providerWill(() => completion(`${polished}\n---CHANGES---\n- Named the sponsor early on :: side project at Mozilla\n- Pretended the list changed :: Wikipedia Unit testing`))
    const res = await handler(request(stageBody('polish', { edit: EDITED })))
    const body = (await res.json()) as StageBody & { notes: Array<{ passage: string }> }
    expect(body.result).toContain('### Sources')
    expect(body.notes.map(n => n.passage)).toEqual(['side project at Mozilla'])
  })

  it('sends no notes field for the other stages', async () => {
    providerWill(() => completion(ARTICLE))
    const body = (await (await handler(request(stageBody('draft', { research: NOTES, outline: '- P' })))).json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('notes')
  })
})
