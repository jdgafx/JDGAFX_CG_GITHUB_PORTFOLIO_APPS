import { useState } from 'react'
import Banner from './components/Banner'
import Conversation from './components/Conversation'
import Header, { type BadgeTone } from './components/Header'
import MessageInput from './components/MessageInput'
import MicPanel from './components/MicPanel'
import RunPanel from './components/RunPanel'
import { useAssistant, type AppState } from './hooks/useAssistant'
import { MAX_RECORDING_MS } from './lib/audio'

const MAX_RECORDING_SECONDS = Math.round(MAX_RECORDING_MS / 1000)

function badgeFor(appState: AppState, hasMic: boolean): { label: string; tone: BadgeTone } {
  switch (appState) {
    case 'recording':
      return { label: 'Recording', tone: 'danger' }
    case 'transcribing':
      return { label: 'Transcribing', tone: 'accent' }
    case 'thinking':
      return { label: 'Thinking', tone: 'accent' }
    case 'speaking':
      return { label: 'Speaking', tone: 'accent' }
    default:
      return hasMic ? { label: 'Ready', tone: 'success' } : { label: 'Text only', tone: 'muted' }
  }
}

export default function App() {
  const assistant = useAssistant()
  const [textInput, setTextInput] = useState('')
  const { appState, hasMic } = assistant
  const busy = appState !== 'idle'
  const badge = badgeFor(appState, hasMic)

  const submitText = () => {
    const text = textInput.trim()
    if (!text || busy) return
    setTextInput('')
    assistant.sendText(text)
  }

  return (
    <div className="ds-app">
      <Header badge={badge.label} tone={badge.tone} />

      <main className="ds-main">
        <section className="ds-card" aria-labelledby="ask-title">
          <div className="ds-card__head">
            <h2 id="ask-title" className="ds-card__title">
              Ask a question
            </h2>
            <span className="ds-hint">Up to {MAX_RECORDING_SECONDS} seconds of speech</span>
          </div>
          <div className="ds-stack">
            <Banner tone="error" message={assistant.error} onDismiss={assistant.dismissError} />
            <Banner tone="info" message={assistant.notice} onDismiss={assistant.dismissNotice} />
            <MicPanel
              appState={appState}
              hasMic={hasMic}
              msLeft={assistant.msLeft}
              analyserRef={assistant.analyserRef}
              onMicClick={assistant.handleMicClick}
              onCancel={assistant.cancel}
            />
            <MessageInput
              value={textInput}
              onChange={setTextInput}
              onSubmit={submitText}
              disabled={busy}
              hasMic={hasMic}
            />
          </div>
        </section>

        <div className="ds-grid-2">
          <Conversation
            messages={assistant.messages}
            onClear={assistant.clearConversation}
            clearDisabled={busy}
          />
          <RunPanel run={assistant.lastRun} />
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
