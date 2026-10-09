import { useCallback, useEffect, useState } from 'react'
import { formatSeconds } from './lib/format'
import { scopeOf } from './lib/modes'
import { useAnalysis } from './lib/useAnalysis'
import type { RunStatus } from './lib/useAnalysis'
import { useNarrow } from './lib/useNarrow'
import { useResultFocus, type RunPhase } from './lib/useResultFocus'
import type { TraceStep } from './lib/api'
import ActionDock from './components/ActionDock'
import AskPanel from './components/AskPanel'
import Header from './components/Header'
import Hero from './components/Hero'
import HistoryStrip from './components/HistoryStrip'
import ImagePicker from './components/ImagePicker'
import PictureStage, { type Picture } from './components/PictureStage'
import ReadoutStrip from './components/ReadoutStrip'
import RegionList from './components/RegionList'
import RunTrace from './components/RunTrace'
import ZoomOverlay from './components/ZoomOverlay'

const PHASE: Record<RunStatus, RunPhase> = {
  idle: 'idle',
  running: 'running',
  complete: 'done',
  failed: 'failed',
  cancelled: 'stopped',
}

function statusLine(status: RunStatus, steps: TraceStep[], totalMs: number | undefined, hasImage: boolean): string {
  if (status === 'running') {
    const current = steps.find(step => step.status === 'running')
    return current ? `Working: ${current.name}` : 'Working: sending the request'
  }
  if (status === 'complete') {
    return totalMs === undefined ? 'Response complete' : `Response complete in ${formatSeconds(totalMs)}`
  }
  if (status === 'failed') return 'The analysis failed. The answer panel says why.'
  if (status === 'cancelled') return 'The analysis was stopped.'
  return hasImage ? 'Ready.' : 'Choose an image to begin.'
}

export default function App() {
  const vision = useAnalysis()
  const { chooseFile } = vision
  const [zoomed, setZoomed] = useState<'a' | 'b' | null>(null)
  const closeZoom = useCallback(() => setZoomed(null), [])
  const { mode, status } = vision
  const scope = scopeOf(mode)
  const comparing = scope === 'compare'
  const hasB = vision.imageUrlB !== ''
  const narrow = useNarrow()

  useResultFocus(PHASE[status])

  // Pasting a screenshot anywhere on the page loads it as the image. While comparing it fills the empty slot.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      const file = Array.from(items)
        .find(item => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!file) return
      event.preventDefault()
      chooseFile(file, null, comparing && vision.file && !hasB ? 'b' : 'a')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [chooseFile, comparing, hasB, vision.file])

  const running = status === 'running'
  const hasImage = vision.imageUrl !== ''
  const a: Picture | null = hasImage
    ? { url: vision.imageUrl, name: vision.file?.name ?? '', credit: vision.source }
    : null
  const b: Picture | null = hasB ? { url: vision.imageUrlB, name: vision.fileB?.name ?? '', credit: vision.sourceB } : null
  const activeRegion = vision.regions.find(entry => entry.id === vision.activeRegionId) ?? null

  // On a phone the picture to draw on sits in the rail, right above the question, so nothing needs scrolling back up.
  const railPicture = narrow && mode === 'region' && a !== null
  const showReadout = status !== 'idle'

  let reason = ''
  if (!hasImage) reason = 'Choose an image first.'
  else if (mode === 'region' && !vision.box) reason = 'Draw a box on the picture first.'
  else if (mode === 'region' && !vision.question.trim()) reason = 'Type a question about the box.'
  else if (mode === 'qa' && !vision.question.trim()) reason = 'Type a question first.'
  else if (comparing && !hasB) reason = 'Choose a second image to compare.'

  return (
    <div className="ds-app" data-run={PHASE[status]}>
      <Header status={status} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <ImagePicker
              comparing={comparing}
              a={a && { name: a.name, url: a.url }}
              b={b && { name: b.name, url: b.url }}
              disabled={running}
              uploadError={vision.uploadError}
              onFile={chooseFile}
              onRemove={vision.removeImage}
            />
            <AskPanel
              mode={mode}
              lastWhole={vision.lastWhole}
              question={vision.question}
              questionError={vision.questionError}
              running={running}
              box={vision.box}
              regionCount={vision.regions.length}
              onModeChange={vision.changeMode}
              onQuestionChange={vision.updateQuestion}
              onRun={vision.run}
            >
              {railPicture && (
                <PictureStage
                  comparing={false}
                  a={a}
                  b={null}
                  regions={vision.regions}
                  activeRegionId={vision.activeRegionId}
                  draft={running ? null : vision.box}
                  editable={!running}
                  onDraft={vision.drawBox}
                  onStart={vision.startBox}
                  onZoom={setZoomed}
                />
              )}
            </AskPanel>
            <ActionDock
              mode={mode}
              running={running}
              canRun={reason === ''}
              reason={reason}
              statusText={statusLine(status, vision.steps, vision.summary?.totalMs, hasImage)}
              onRun={vision.run}
              onCancel={vision.cancel}
            />
          </div>

          <div className="ds-run">
            <Hero
              mode={mode}
              status={status}
              a={a}
              b={b}
              regions={vision.regions}
              activeRegion={activeRegion}
              draft={vision.box}
              result={vision.result}
              truncated={vision.truncated}
              notice={vision.notice}
              onDraft={vision.drawBox}
              onStart={vision.startBox}
              onZoom={setZoomed}
              onRetry={vision.run}
              hidePictures={railPicture}
            />
            {showReadout && <ReadoutStrip status={status} steps={vision.steps} summary={vision.summary} />}
            {scope === 'region' && vision.regions.length > 0 && (
              <RegionList
                regions={vision.regions}
                activeId={vision.activeRegionId}
                disabled={running}
                onSelect={vision.selectRegion}
              />
            )}
            {vision.steps.length > 0 && <RunTrace steps={vision.steps} summary={vision.summary} />}
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

      {zoomed && (
        <ZoomOverlay
          src={zoomed === 'a' ? vision.imageUrl : vision.imageUrlB}
          label={(zoomed === 'a' ? vision.file?.name : vision.fileB?.name) || 'image'}
          onClose={closeZoom}
        />
      )}
    </div>
  )
}
