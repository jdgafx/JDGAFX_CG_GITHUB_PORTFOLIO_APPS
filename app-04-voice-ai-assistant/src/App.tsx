import { useState } from 'react'
import AnswerCard from './components/AnswerCard'
import AskPanel from './components/AskPanel'
import Dock from './components/Dock'
import Examples from './components/Examples'
import Header from './components/Header'
import History from './components/History'
import Notice from './components/Notice'
import Pipeline from './components/Pipeline'
import Readout from './components/Readout'
import Trace from './components/Trace'
import VoiceCapture from './components/VoiceCapture'
import { useAssistant } from './hooks/useAssistant'
import { liveStep, pipelineView, type RunPhase } from './lib/pipeline'
import type { Stage } from './lib/run'
import { useResultFocus } from './lib/useResultFocus'
import { liveData } from './lib/liveData'
import { badgeFor, statusLine } from './lib/view'

// The model writing and the voice reading both belong to the stages the pipeline already names.
const PHASE: Record<Stage, RunPhase> = {
  idle: 'idle',
  recording: 'recording',
  transcribing: 'transcribing',
  thinking: 'thinking',
  answering: 'thinking',
  speaking: 'speaking',
}

export default function App() {
  const assistant = useAssistant()
  const [text, setText] = useState('')
  const [collapseKey, setCollapseKey] = useState(0)
  const { run, busy, recording, hasMic } = assistant
  const phase = PHASE[run.stage]
  const steps = run.outcome === 'idle' ? null : run.steps
  const asked = text.trim()

  // On a phone the answer sits below the controls: the hook scrolls it into view and focuses its heading when a run ends.
  useResultFocus(run.outcome, { onRunStart: narrow => narrow && setCollapseKey(n => n + 1) })

  const ask = (question: string) => {
    if (!question || busy) return
    setText('')
    assistant.sendText(question)
  }

  return (
    <div className="ds-app" data-run={run.outcome}>
      <Header badge={badgeFor(run, hasMic)} live={liveData(run.steps, run.arrivedAt)} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <Notice message={assistant.notice} onDismiss={assistant.dismissNotice} />
            <VoiceCapture
              hasMic={hasMic}
              recording={recording}
              disabled={busy && !recording}
              msLeft={assistant.msLeft}
              analyserRef={assistant.analyserRef}
              onToggle={recording ? assistant.finishRecording : assistant.startRecording}
            />
            <AskPanel value={text} onChange={setText} onSubmit={() => ask(asked)} disabled={busy} />
            <Dock
              recording={recording}
              busy={busy}
              hasMic={hasMic}
              canAsk={asked.length > 0}
              onFinishRecording={assistant.finishRecording}
              onRecord={assistant.startRecording}
              onStop={assistant.stopRun}
            />
            <p className="ds-help vox-status" role="status">
              {statusLine(run, hasMic)}
            </p>
            <Examples onPick={setText} disabled={busy} collapseKey={collapseKey} />
          </div>

          <div className="ds-run">
            <AnswerCard run={run} onRetry={() => ask(run.question)} />
            <Readout run={run} />
            <Pipeline view={pipelineView(phase, steps, run.voice === 'speaking' && run.outcome === 'running')} model={run.model} />
            <Trace run={run} live={run.outcome === 'running' ? liveStep(phase, steps) : null} />
            <History messages={assistant.messages} clearDisabled={busy} onClear={assistant.clearConversation} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
