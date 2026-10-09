import { useCallback, useEffect, useState } from 'react'
import { formatSeconds } from './lib/format'
import { MODE_LABELS } from './lib/modes'
import { useAnalysis } from './lib/useAnalysis'
import type { RunStatus } from './lib/useAnalysis'
import type { TraceStep } from './lib/api'
import AnalysisPanel from './components/AnalysisPanel'
import HistoryStrip from './components/HistoryStrip'
import ImagePicker from './components/ImagePicker'
import ModeChoice from './components/ModeChoice'
import PicturePanel from './components/PicturePanel'
import ReadoutStrip from './components/ReadoutStrip'
import ResultPanel from './components/ResultPanel'
import RunTrace from './components/RunTrace'
import ZoomOverlay from './components/ZoomOverlay'

// The dot repeats the badge's state as a mark, so the status never relies on colour alone.
const STATUS_DISPLAY: Record<RunStatus, { label: string; badge: string; dot: string }> = {
  idle: { label: 'Ready', badge: '', dot: '' },
  running: { label: 'Analyzing', badge: 'ds-badge--accent', dot: 'ds-dot--running' },
  complete: { label: 'Complete', badge: 'ds-badge--success', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', badge: 'ds-badge--danger', dot: 'ds-dot--failed' },
  cancelled: { label: 'Cancelled', badge: 'ds-badge--warning', dot: '' },
}

function statusLine(status: RunStatus, steps: TraceStep[], totalMs: number | undefined, hasImage: boolean): string {
  if (status === 'running') {
    const current = steps.find(step => step.status === 'running')
    return current ? `Analyzing: ${current.name}` : 'Analyzing: sending the image'
  }
  if (status === 'complete') {
    return totalMs === undefined ? 'Response complete' : `Response complete in ${formatSeconds(totalMs)}`
  }
  if (status === 'failed') return 'The analysis failed. The reason is shown with the answer.'
  if (status === 'cancelled') return 'The analysis was cancelled.'
  return hasImage ? 'Ready to analyze.' : 'Choose an image to begin.'
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
  const fileName = vision.file?.name ?? ''
  const display = STATUS_DISPLAY[vision.status]

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">VisionLab</h1>
            <p className="ds-subtitle">Choose one image, pick a mode, and read the answer as it streams in.</p>
          </div>
          <span className={`ds-badge ${display.badge}`}>
            <span className={`ds-dot ${display.dot}`} aria-hidden="true" />
            {display.label}
          </span>
          <p className="ds-showcase">
            <strong>What this showcases:</strong> a multimodal call, one image and one prompt in, a streamed answer out,
            with the reply checked for completeness before it is marked done.
          </p>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <ImagePicker
              imageUrl={vision.imageUrl}
              fileName={fileName}
              disabled={running}
              uploadError={vision.uploadError}
              onFile={vision.chooseFile}
              onRemove={vision.removeImage}
            />
            <ModeChoice
              mode={vision.mode}
              question={vision.question}
              questionError={vision.questionError}
              running={running}
              onModeChange={vision.changeMode}
              onQuestionChange={vision.updateQuestion}
              onRun={vision.run}
            />
            <AnalysisPanel
              running={running}
              canRun={hasImage}
              statusText={statusLine(vision.status, vision.steps, vision.summary?.totalMs, hasImage)}
              onRun={vision.run}
              onCancel={vision.cancel}
            />
          </div>

          <div className="ds-run">
            {/* The hero: the picture beside the reply that streams in for it. The mode's name leads. */}
            <section className="ds-section" aria-labelledby="answer-title">
              <div className="ds-section__head">
                <h2 id="answer-title" className="answer-title">
                  {MODE_LABELS[vision.mode]}
                </h2>
                <p className="ds-section__sub">The picture and the reply, which streams in as the model writes it.</p>
              </div>

              <div className="answer-stage">
                <PicturePanel
                  imageUrl={vision.imageUrl}
                  fileName={fileName}
                  credit={vision.source}
                  disabled={running}
                  onFile={vision.chooseFile}
                  onZoom={() => setZoomed(true)}
                />
                <ResultPanel
                  result={vision.result}
                  status={vision.status}
                  truncated={vision.truncated}
                  notice={vision.notice}
                />
              </div>
            </section>
            <ReadoutStrip summary={vision.summary} />
            <RunTrace steps={vision.steps} summary={vision.summary} />
            <HistoryStrip
              items={vision.gallery}
              activeId={vision.activeId}
              disabled={running}
              onSelect={vision.reopen}
              onClear={vision.clearGallery}
            />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>

      {zoomed && hasImage && (
        <ZoomOverlay src={vision.imageUrl} label={fileName || 'image'} onClose={closeZoom} />
      )}
    </div>
  )
}
