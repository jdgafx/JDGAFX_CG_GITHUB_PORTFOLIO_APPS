import { transcriptFromResults } from './transcript'

interface BrowserRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => BrowserRecognition

function constructorForBrowser(): RecognitionConstructor | null {
  const browserWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null
}

export interface BrowserTranscriptHandle {
  getText: () => string
  stop: () => void
}

// A second, local transcript kept alongside the recording. It is used only when
// the server cannot transcribe the clip.
export function startBrowserTranscript(): BrowserTranscriptHandle | null {
  const Recognition = constructorForBrowser()
  if (!Recognition) return null

  const recognition = new Recognition()
  let text = ''
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = 'en-US'
  recognition.onresult = event => {
    text = transcriptFromResults(event.results)
  }
  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    getText: () => text,
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // Already stopped; there is nothing left to end.
      }
    },
  }
}
