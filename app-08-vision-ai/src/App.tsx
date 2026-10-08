import { useCallback, useEffect, useState } from 'react'
import { formatSeconds } from './lib/format'
import { useAnalysis } from './lib/useAnalysis'
import type { RunStatus } from './lib/useAnalysis'
import type { TraceStep } from './lib/api'
import AnalysisPanel from './components/AnalysisPanel'
import HistoryStrip from './components/HistoryStrip'
import ImageCard from './components/ImageCard'
import ResultPanel from './components/ResultPanel'
import RunTrace from './components/RunTrace'
import ZoomOverlay from './components/ZoomOverlay'

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: 'Ready',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const STATUS_BADGE: Record<RunStatus, string> = {
  idle: '',
  running: 'ds-badge--accent',
  complete: 'ds-badge--success',
  failed: 'ds-badge--danger',
  cancelled: 'ds-badge--warning',
}

function statusLine(status: RunStatus, steps: TraceStep[], totalMs: number | undefined, hasImage: boolean): string {
  if (status === 'running') {
    const current = steps.find(step => step.status === 'running')
    return current ? `Running: ${current.name}` : 'Sending the image'
  }
  if (status === 'complete') {
    return totalMs === undefined ? 'Response complete' : `Response complete in ${formatSeconds(totalMs)}`
  }
  if (status === 'failed') return 'The run failed. The reason is shown under the result.'
  if (status === 'cancelled') return 'The run was cancelled.'
  return hasImage ? 'Ready to run.' : 'Choose an image to begin.'
}

export default function App() {
  const vision = useAnalysis()
  const { chooseFile } = vision
  const [zoomed, setZoomed] = useState(false)
  const closeZoom = useCallback(() => setZoomed(false), [])

  // Pasting a screenshot anywhere on the page loads it as the image.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      const file = Array.from(items)
        .find(item => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!file) return
      event.preventDefault()
      chooseFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [chooseFile])

  const running = vision.status === 'running'
  const hasImage = vision.imageUrl !== ''

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">VisionLab</h1>
            <p className="ds-subtitle">Describe, analyze, extract, or ask about one image.</p>
          </div>
          <span className={`ds-badge ${STATUS_BADGE[vision.status]}`}>{STATUS_LABEL[vision.status]}</span>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-grid-2">
          <ImageCard
            imageUrl={vision.imageUrl}
            fileName={vision.file?.name ?? ''}
            disabled={running}
            uploadError={vision.uploadError}
            onFile={vision.chooseFile}
            onRemove={vision.removeImage}
            onZoom={() => setZoomed(true)}
          />
          <AnalysisPanel
            mode={vision.mode}
            question={vision.question}
            questionError={vision.questionError}
            running={running}
            canRun={hasImage}
            statusText={statusLine(vision.status, vision.steps, vision.summary?.totalMs, hasImage)}
            onModeChange={vision.changeMode}
            onQuestionChange={vision.updateQuestion}
            onRun={vision.run}
            onCancel={vision.cancel}
          />
        </div>

        <ResultPanel
          result={vision.result}
          status={vision.status}
          truncated={vision.truncated}
          notice={vision.notice}
        />

        <RunTrace steps={vision.steps} summary={vision.summary} />

        {vision.gallery.length > 0 && (
          <HistoryStrip
            items={vision.gallery}
            activeId={vision.activeId}
            disabled={running}
            onSelect={vision.reopen}
            onClear={vision.clearGallery}
          />
        )}
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>

      {zoomed && hasImage && (
        <ZoomOverlay src={vision.imageUrl} label={vision.file?.name ?? 'image'} onClose={closeZoom} />
      )}
    </div>
  )
}
