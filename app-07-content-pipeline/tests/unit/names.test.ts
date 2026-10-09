import { describe, expect, it } from 'vitest'
import { namesFor } from '../../src/lib/names'
import { sentenceCase } from '../../src/lib/titles'
import type { SourcePack } from '../../netlify/shared/sourcepack'

const PACK: SourcePack = {
  sources: [{ n: 1, kind: 'wikipedia', title: 'Rust (programming language)', url: 'https://en.wikipedia.org/wiki/Rust', summary: 'Rust was sponsored by Mozilla Research. Java checks bounds at runtime. Graydon Hoare started it.' }],
  notes: [],
}

describe('namesFor', () => {
  it('collects topic words and mid-sentence names from the sources, with possessives, and skips sentence starts', () => {
    const names = namesFor('The Rust language', PACK)
    expect(names).toEqual(expect.arrayContaining(['Rust', 'Rusts', 'Mozilla', 'Research', 'Hoare']))
    // "Java" and "Graydon" start sentences, so they are not known as names.
    expect(names).not.toContain('Java')
    expect(names).not.toContain('Graydon')
  })

  it('keeps names capitalised when a heading goes to sentence case', () => {
    const names = namesFor('The Rust language', PACK)
    expect(sentenceCase("Rust's Approach Without a Garbage Collector", names)).toBe("Rust's approach without a garbage collector")
    expect(sentenceCase('Understanding Memory Safety in Rust', names)).toBe('Understanding memory safety in Rust')
  })
})
