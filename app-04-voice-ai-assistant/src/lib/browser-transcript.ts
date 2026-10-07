interface BrowserRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
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

export function browserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && constructorForBrowser() !== null
}

export interface BrowserTranscriptHandle {
  getText: () => string
  stop: () => void
}

export function startBrowserTranscript(): BrowserTranscriptHandle | null {
  const Recognition = constructorForBrowser()
  if (!Recognition) return null

  const recognition = new Recognition()
  let text = ''
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = 'en-US'
  recognition.onresult = event => {
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (result?.[0]?.transcript) text = `${text} ${result[0].transcript}`.trim()
    }
  }
  recognition.onerror = () => undefined
  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    getText: () => text.trim(),
    stop: () => {
      try { recognition.stop() } catch { /* already stopped */ }
    },
  }
}
