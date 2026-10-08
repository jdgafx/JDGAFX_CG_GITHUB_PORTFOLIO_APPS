import { useState } from 'react'
import Banner from './components/Banner'
import Conversation from './components/Conversation'
import Header, { type BadgeInfo } from './components/Header'
import MessageInput from './components/MessageInput'
import MicPanel from './components/MicPanel'
import Pipeline from './components/Pipeline'
import Playback from './components/Playback'
import RunPanel from './components/RunPanel'
import { useAssistant, type AppState } from './hooks/useAssistant'
import { liveStep, pipelineView } from './lib/pipeline'

const LIVE_DOT = 'ds-dot ds-dot--running'

function badgeFor(appState: AppState, hasMic: boolean): BadgeInfo {
  switch (appState) {
    case 'recording':
      return { label: 'Recording', tone: 'accent', dot: LIVE_DOT }
    case 'transcribing':
      return { label: 'Transcribing', tone: 'accent', dot: LIVE_DOT }
    case 'thinking':
      return { label: 'Thinking', tone: 'accent', dot: LIVE_DOT }
    case 'speaking':
      return { label: 'Speaking', tone: 'accent', dot: LIVE_DOT }
    default:
      return hasMic
        ? { label: 'Ready', tone: 'success', dot: 'ds-dot ds-dot--ok' }
        : { label: 'Text only', tone: 'muted', dot: 'ds-dot' }
  }
}

export default function App() {
  const assistant = useAssistant()
  const [textInput, setTextInput] = useState('')
  const { appState, hasMic, lastRun, messages } = assistant
  const busy = appState !== 'idle'
  const recording = appState === 'recording'
  // A new recording has no run record yet, so the run card shows only its live step.
  const run = recording ? null : lastRun
  const steps = run ? run.steps : null
  // Figures the provider has not reported yet read as pending, until the reply comes back.
  const pending = busy && appState !== 'speaking'

  const submitText = () => {
    const text = textInput.trim()
    if (!text || busy) return
    setTextInput('')
    assistant.sendText(text)
  }

  return (
    <div className="ds-app">
      <Header badge={badgeFor(appState, hasMic)} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <Banner tone="error" message={assistant.error} onDismiss={assistant.dismissError} />
            <Banner tone="info" message={assistant.notice} onDismiss={assistant.dismissNotice} />
            <MicPanel
              appState={appState}
              hasMic={hasMic}
              msLeft={assistant.msLeft}
              onMicClick={assistant.handleMicClick}
              onCancel={assistant.cancel}
            />
            <MessageInput value={textInput} onChange={setTextInput} onSubmit={submitText} disabled={busy} />
            <Playback
              speaking={appState === 'speaking'}
              clearDisabled={busy || messages.length === 0}
              onStop={assistant.stopSpeaking}
              onClear={assistant.clearConversation}
            />
          </div>

          <div className="ds-run">
            <Pipeline
              view={pipelineView(appState, steps)}
              model={run?.model}
              idle={!busy && lastRun === null}
            />
            <Conversation messages={messages} recording={recording} analyserRef={assistant.analyserRef} />
            <RunPanel run={run} live={liveStep(appState, steps)} pending={pending} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
