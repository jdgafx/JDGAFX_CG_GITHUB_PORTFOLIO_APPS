import type { AnalysisMode } from '../lib/api'
import { MODE_LABELS } from '../lib/modes'
import type { RegionEntry, RunStatus } from '../lib/useAnalysis'
import AnswerPane from './AnswerPane'
import PictureStage, { type Picture } from './PictureStage'
import type { Box } from '../lib/region'

interface HeroProps {
  mode: AnalysisMode
  status: RunStatus
  a: Picture | null
  b: Picture | null
  regions: RegionEntry[]
  activeRegion: RegionEntry | null
  draft: Box | null
  result: string
  truncated: boolean
  notice: string
  onDraft: (box: Box | null) => void
  onStart: () => void
  onZoom: (slot: 'a' | 'b') => void
  onRetry: () => void
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

function titleFor(mode: AnalysisMode, region: RegionEntry | null): string {
  if (mode === 'region' && region) return `Region ${region.tag}`
  return MODE_LABELS[mode]
}

// The hero of the page: the picture or pictures with every box drawn on them, and the reply that streams in for them.
export default function Hero(props: HeroProps) {
  const { mode, status, activeRegion } = props
  const comparing = mode === 'compare'
  // A box that was asked but did not finish stays as the draft, so it can be asked again; draw it once, not twice.
  const drawn = props.regions.filter(entry => !(props.draft && entry.status !== 'complete' && sameBox(entry.box, props.draft)))
  return (
    <section className="ds-run__result vl-hero" aria-labelledby="answer-title">
      <h2 id="answer-title" className="vl-hero__title" data-result-focus tabIndex={-1}>
        {titleFor(mode, activeRegion)}
      </h2>
      <div className={comparing ? 'vl-hero__grid vl-hero__grid--pair' : 'vl-hero__grid'}>
        <PictureStage
          comparing={comparing}
          a={props.a}
          b={props.b}
          regions={mode === 'region' ? drawn : []}
          activeRegionId={mode === 'region' ? (activeRegion?.id ?? null) : null}
          draft={mode === 'region' && status !== 'running' ? props.draft : null}
          editable={mode === 'region' && status !== 'running' && props.a !== null}
          onDraft={props.onDraft}
          onStart={props.onStart}
          onZoom={props.onZoom}
        />
        <AnswerPane
          mode={mode}
          result={props.result}
          status={status}
          truncated={props.truncated}
          notice={props.notice}
          region={activeRegion}
          onRetry={props.onRetry}
        />
      </div>
    </section>
  )
}
