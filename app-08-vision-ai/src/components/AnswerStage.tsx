import type { AnalysisMode } from '../lib/api'
import { MODE_LABELS } from '../lib/modes'
import type { RunStatus } from '../lib/useAnalysis'
import PicturePanel from './PicturePanel'
import ResultPanel from './ResultPanel'

interface AnswerStageProps {
  mode: AnalysisMode
  imageUrl: string
  fileName: string
  result: string
  status: RunStatus
  truncated: boolean
  notice: string
  onFile: (file: File) => void
  onZoom: () => void
}

// The hero: the picture beside the reply that streams in for it. The mode's name leads.
export default function AnswerStage({
  mode,
  imageUrl,
  fileName,
  result,
  status,
  truncated,
  notice,
  onFile,
  onZoom,
}: AnswerStageProps) {
  return (
    <section className="ds-section" aria-labelledby="answer-title">
      <div className="ds-section__head">
        <h2 id="answer-title" className="answer-title">
          {MODE_LABELS[mode]}
        </h2>
        <p className="ds-section__sub">The picture and the reply, which streams in as the model writes it.</p>
      </div>

      <div className="answer-stage">
        <PicturePanel
          imageUrl={imageUrl}
          fileName={fileName}
          disabled={status === 'running'}
          onFile={onFile}
          onZoom={onZoom}
        />
        <ResultPanel result={result} status={status} truncated={truncated} notice={notice} />
      </div>
    </section>
  )
}
