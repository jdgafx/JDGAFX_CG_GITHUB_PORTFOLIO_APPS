import { useState, type FormEvent } from 'react'
import { parseArxivId } from '../lib/arxivId'

/** Papers under the 5 MB cap, as one-click starts. Only the IDs are kept here; the PDF is fetched live on click. */
const EXAMPLE_PAPERS = [
  { id: '1706.03762', name: 'Attention Is All You Need' },
  { id: '1810.04805', name: 'BERT' },
  { id: '1412.6980', name: 'Adam' },
]

interface ArxivPickerProps {
  busy: boolean
  onLoad: (id: string) => void
  onError: (message: string) => void
}

/** An arXiv ID or link, fetched by your browser from arxiv.org and read like an upload. */
export function ArxivPicker({ busy, onLoad, onError }: ArxivPickerProps) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy || value.trim() === '') return
    const id = parseArxivId(value)
    if (id) onLoad(id)
    else onError('That is not an arXiv ID. Use an ID such as 1706.03762, or paste an arxiv.org link.')
  }

  return (
    <div className="ds-stack">
      <form className="ds-stack" onSubmit={handleSubmit}>
        <div className="ds-field">
          <label htmlFor="docmind-arxiv" className="ds-label">
            arXiv ID or link
          </label>
          <div className="docmind-inline">
            <input
              id="docmind-arxiv"
              className="ds-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="1706.03762"
              value={value}
              disabled={busy}
              aria-describedby="docmind-arxiv-help"
              onChange={e => setValue(e.target.value)}
            />
            <button type="submit" className="ds-button ds-button--primary" disabled={busy || value.trim() === ''}>
              Load
            </button>
          </div>
          <p id="docmind-arxiv-help" className="ds-help">
            Your browser fetches the PDF from arxiv.org, up to 5 MB, and reads its text as it does for an upload.
          </p>
        </div>
      </form>

      <div className="ds-stack">
        <p className="ds-label">Or start with one of these</p>
        <ul className="docmind-choices docmind-choices--chips" aria-label="Example arXiv papers">
          {EXAMPLE_PAPERS.map(paper => (
            <li key={paper.id}>
              <button type="button" className="docmind-choice" disabled={busy} onClick={() => onLoad(paper.id)}>
                <span className="ds-mono">{paper.id}</span> {paper.name}
              </button>
            </li>
          ))}
        </ul>
        <p className="ds-help">One click fetches the paper live from arXiv.</p>
      </div>
    </div>
  )
}
