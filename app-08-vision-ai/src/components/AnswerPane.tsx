import { parseComparison } from '../../netlify/shared/compare'
import type { AnalysisMode } from '../lib/api'
import { describeRect } from '../lib/region'
import type { RegionEntry, RunStatus } from '../lib/useAnalysis'
import { Inline } from './RichText'
import RichText from './RichText'

interface AnswerPaneProps {
  mode: AnalysisMode
  result: string
  status: RunStatus
  truncated: boolean
  notice: string
  region: RegionEntry | null
  onRetry: () => void
}

const EMPTY_BODY: Record<AnalysisMode, string> = {
  describe: 'Choose an image, then analyze it. The answer streams in here.',
  analyze: 'Choose an image, then analyze it. The answer streams in here.',
  qa: 'Choose an image, type a question and analyze it. The answer streams in here.',
  extract: 'Choose an image with text or numbers in it. The extracted text streams in here.',
  region: 'Draw a box on the picture, type a question and ask. The crop and its answer appear here.',
  compare: 'Choose two images and compare them. Similarities, differences and a verdict appear here.',
}

function RegionHead({ region }: { region: RegionEntry }) {
  return (
    <div className="vl-regionhead">
      {region.cropUrl ? (
        <img src={region.cropUrl} alt={`The part of the picture inside box ${region.tag}`} className="vl-regionhead__crop" />
      ) : (
        <span className="vl-regionhead__crop vl-regionhead__crop--pending" aria-hidden="true" />
      )}
      <div className="vl-regionhead__text">
        <p className="vl-regionhead__meta">
          <span className="ds-chip">{region.tag}</span>
          <span className="ds-mono">{region.rect ? describeRect(region.rect) : 'cutting…'}</span>
        </p>
        <p className="vl-regionhead__q">{region.question}</p>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <span className="ds-skeleton vl-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function Column({ title, items, waiting }: { title: string; items: string[]; waiting: boolean }) {
  return (
    <section className="vl-col" aria-label={title}>
      <h3 className="vl-col__title">
        {title}
        <span className="ds-chip ds-chip--muted">{items.length}</span>
      </h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      ) : waiting ? (
        <Skeleton />
      ) : (
        <p className="ds-help">Nothing came back for this part.</p>
      )}
    </section>
  )
}

// The comparison reply under its three headings: similarities and differences side by side, the verdict across both.
function ComparePane({ text, running }: { text: string; running: boolean }) {
  const parsed = parseComparison(text)
  return (
    <div className="vl-compare">
      <div className="vl-compare__cols">
        <Column title="Similarities" items={parsed.similarities} waiting={running} />
        <Column title="Differences" items={parsed.differences} waiting={running} />
      </div>
      <section className="ds-lead vl-verdict" aria-label="Verdict">
        <h3 className="vl-col__title">Verdict</h3>
        {parsed.verdict ? (
          <p className="vl-verdict__text">
            <Inline text={parsed.verdict} />
          </p>
        ) : running ? (
          <Skeleton />
        ) : (
          <p className="ds-help">No verdict came back.</p>
        )}
      </section>
    </div>
  )
}

export default function AnswerPane({ mode, result, status, truncated, notice, region, onRetry }: AnswerPaneProps) {
  const running = status === 'running'
  const failed = status === 'failed'
  const stopped = status === 'cancelled'
  const hasText = result.trim() !== ''

  return (
    <div className="vl-answer">
      {mode === 'region' && region && <RegionHead region={region} />}

      <div aria-live="polite" aria-busy={running}>
        {hasText ? (
          mode === 'compare' ? (
            <ComparePane text={result} running={running} />
          ) : (
            <div className="ds-lead vl-lead">
              <RichText text={result} streaming={running} />
            </div>
          )
        ) : running ? (
          <div className="ds-state ds-state--loading">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">Waiting for the first words</p>
            <p className="ds-state__body">The model is reading the picture.</p>
            <Skeleton />
          </div>
        ) : !failed && !stopped ? (
          <div className="ds-state ds-state--empty">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">{mode === 'region' ? 'No region asked yet' : 'No answer yet'}</p>
            <p className="ds-state__body">{EMPTY_BODY[mode]}</p>
          </div>
        ) : null}
      </div>

      {truncated && (
        <p className="ds-notice ds-notice--warning" role="status">
          Output was cut off before the model finished. Crop the image to the part you need, or ask again.
        </p>
      )}
      {failed && (
        <div className={`ds-state ${hasText ? 'ds-state--partial' : 'ds-state--error'}`} role="alert">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">{hasText ? 'Partial answer' : 'The analysis failed'}</p>
          <p className="ds-state__body">{notice}</p>
          <div className="ds-state__actions">
            <button type="button" className="ds-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      )}
      {stopped && (
        <div className="ds-state ds-state--stopped" role="status">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">Run stopped</p>
          <p className="ds-state__body">{notice}</p>
          <div className="ds-state__actions">
            <button type="button" className="ds-button" onClick={onRetry}>
              Start again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
