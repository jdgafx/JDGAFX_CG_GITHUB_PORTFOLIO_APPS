import type { QueryPlan, Vocabulary } from '../types'
import { planFilters, ROWS } from './questionNouns'
import { shownLabel } from './vocabulary'

const SMALL_WORDS = new Set(['with', 'from', 'into', 'over', 'under', 'above', 'below', 'than', 'that', 'this', 'across', 'between', 'versus', 'each', 'per'])

/**
 * A chart title in sentence case. Models like "Total Precipitation by Month"; the page's copy rule is
 * "Total precipitation by month". Only a title that is really Title Case is touched, and words that are
 * acronyms, hold digits or name a group on the chart (Alaska, Tokyo) keep their capitals.
 */
export function sentenceCase(title: string, keep: string[] = []): string {
  const words = title.split(' ')
  // Small words that Title Case leaves lowercase ("with", "above") do not count against a title being Title Case.
  // A token such as "mRNA" or "iPhone" is a brand-style name: it neither makes a title Title Case nor is changed.
  const mixed = (word: string) => /^[^A-Za-z]*[a-z]+[A-Z]/.test(word)
  const long = words.filter((word) => {
    const letters = word.replace(/[^A-Za-z]/g, '')
    return letters.length > 3 && !SMALL_WORDS.has(letters.toLowerCase()) && !mixed(word)
  })
  // One long word is enough when every other word is capitalised too ("The Mechanism", "Key Findings").
  const others = words.filter((word) => !long.includes(word) && !mixed(word) && /[A-Za-z]/.test(word))
  const single = long.length === 1 && words.length > 1 && others.every((word) => /^[^A-Za-z]*[A-Z]/.test(word))
  if ((long.length < 2 && !single) || !long.every((word) => /^[^A-Za-z]*[A-Z]/.test(word))) return title
  const names = new Set(keep.map((name) => name.toLowerCase()))
  return words
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, '')
      // A unit such as "°C" or "m" and a lone letter keep their case.
      if (index === 0 || letters.length < 2 || word.includes('°') || mixed(word)) return word
      if (/\d/.test(word) || (letters.length > 1 && letters === letters.toUpperCase()) || names.has(letters.toLowerCase())) return word
      return word.replace(/[A-Z]/, (c) => c.toLowerCase())
    })
    .join(' ')
}

/**
 * The words in a chart title that are names in the data and keep their capitals: the groups drawn (as stored and as the page
 * shows them) and the values the plan filters on. A model that writes "...in Alaska" in Title Case would otherwise have
 * "Alaska" lowered to "alaska" when the title is put in sentence case.
 */
export function titleNames(plan: QueryPlan, labels: string[], vocab: Vocabulary): string[] {
  return [...labels, ...labels.map((label) => shownLabel(vocab, label)), ...planFilters(plan).map((filter) => filter.value)]
}

interface Titled {
  queryPlan: { title: string; groupBy: string; countColumn?: string; missing?: string[] }
}

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * The title a chart, its CSV and its PNG carry. It is the model's title in sentence case, except where the model's words
 * cannot be trusted to describe what is drawn:
 * - a stand-in chart: the model's title names what the question asked for ("Average wind speed by month"), but the chart
 *   plots something else, so the title says what is plotted and what it stands in for;
 * - a total: it has no groups, so a title that says "by region" would name a grouping that is not there. The title is what
 *   the plan computes, which the caller passes as `plotted`.
 * `keep` lists words that are names in the data (group labels, values the plan filters on) and keep their capitals.
 */
export function chartTitle(result: Titled, plotted: string, keep: string[] = []): string {
  const { missing, title, countColumn } = result.queryPlan
  if (missing && missing.length > 0) return `${capitalised(plotted)} (stand-in for ${missing.join(', ')})`
  if (countColumn === ROWS) return capitalised(plotted)
  return sentenceCase(title, keep)
}
