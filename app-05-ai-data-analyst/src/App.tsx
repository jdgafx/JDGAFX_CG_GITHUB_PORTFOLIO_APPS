import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { headlineFor } from './lib/answer'
import { parseCSV } from './lib/dataEngine'
import { CITIES, DATASET_CHOICES, DEFAULT_CITY, DEFAULT_DATASET } from './lib/liveData/catalog'
import { MAX_ROWS } from './lib/limits'
import { plainText } from './lib/prose'
import { useResultFocus } from './lib/useResultFocus'
import { RAW_VOCABULARY } from './lib/vocabulary'
import { useAnalysisThread, type AnalysisThreadState, type AskMode } from './hooks/useAnalysisThread'
import { useLiveDataset, type DatasetState } from './hooks/useLiveDataset'
import AppHeader, { type HeaderStatus } from './components/AppHeader'
import DataSection from './components/DataSection'
import QueryBar from './components/QueryBar'
import Banners from './components/Banners'
import RunColumn from './components/RunColumn'
import type { DatasetOption, LoadedDataset } from './types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const CUSTOM = 'custom'

/** The live status line. It uses the same verb as the primary button: Plan and run. */
function statusMessage(state: AnalysisThreadState, hasData: boolean): string {
  const { pending, run, step } = state
  if (pending) return pending.mode === 'follow-up' ? 'Refining the plan from your follow-up.' : 'Planning and running your question.'
  if (run?.outcome === 'failed') return 'Plan and run failed. The message in the result says why.'
  if (run?.outcome === 'stopped') return 'Plan and run stopped before a reply.'
  if (run?.outcome === 'done' && step) {
    if (step.notApplied) return `Follow-up not applied. ${plainText(step.notApplied)}`
    const { notice, answer } = headlineFor(step.result)
    return `Plan and run complete. ${plainText(notice ?? answer ?? step.result.queryPlan.title)}`
  }
  return hasData ? 'Type a question, then choose Plan and run.' : ''
}

export default function App() {
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET)
  const [cityId, setCityId] = useState<string>(DEFAULT_CITY)
  const [upload, setUpload] = useState<LoadedDataset | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [lastAsk, setLastAsk] = useState<{ question: string; mode: AskMode } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [examplesOpen, setExamplesOpen] = useState<boolean>(() => window.matchMedia('(min-width: 1000px)').matches)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const choice = DATASET_CHOICES.find((item) => item.id === selectedDataset)
  const live = useLiveDataset(choice?.id ?? null, cityId)
  const datasetState: DatasetState =
    choice || !upload ? live.state : { status: 'ready', loaded: upload }
  const loaded = datasetState.status === 'ready' ? datasetState.loaded : null
  const parsedData = loaded?.data ?? null
  const vocab = loaded?.vocab ?? RAW_VOCABULARY

  const options = useMemo<DatasetOption[]>(() => {
    const liveOptions = DATASET_CHOICES.map(({ id, label }) => ({ value: id, label: `${label} (live)` }))
    return upload ? [...liveOptions, { value: CUSTOM, label: upload.source.label }] : liveOptions
  }, [upload])
  const datasetLabel = loaded?.source.label ?? selectedDataset

  const analysis = useAnalysisThread({ data: parsedData, dataset: datasetLabel, vocab })
  const { close } = analysis
  const isLoading = analysis.pending !== null

  // A result belongs to the rows it was computed from, so it is put away when those rows change.
  const clearResult = () => {
    close()
    setFileError(null)
    setNotice(null)
  }

  const handleSelect = (value: string) => {
    setSelectedDataset(value)
    clearResult()
  }

  const handleCityChange = (value: string) => {
    setCityId(value)
    clearResult()
  }

  const handleReload = () => {
    live.reload()
    clearResult()
  }

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    // Reset the input so re-selecting the same file triggers onChange
    e.target.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('That file is not a .csv. Please choose a comma-separated values file.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError('That file is larger than 5 MB. Choose a smaller CSV.')
      return
    }

    setFileError(null)
    setNotice(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = typeof evt.target?.result === 'string' ? evt.target.result : ''
      if (text.trim() === '') {
        setFileError(`"${file.name}" is empty. Choose a CSV with a header row and at least one data row.`)
        return
      }
      try {
        const parsed = parseCSV(text)
        const noticeParts: string[] = []
        if (parsed.truncated) {
          noticeParts.push(
            `Large file: charting the first ${MAX_ROWS.toLocaleString()} of ${parsed.totalRows?.toLocaleString()} rows.`,
          )
        } else if (parsed.rows.length === 0) {
          noticeParts.push(`"${file.name}" has a header row but no data rows, so there is nothing to chart.`)
        }
        if (parsed.parseErrorRowCount) {
          const noun = parsed.parseErrorRowCount === 1 ? 'row' : 'rows'
          noticeParts.push(
            `${parsed.parseErrorRowCount.toLocaleString()} ${noun} in this file could not be parsed cleanly and may be incomplete.`,
          )
        }
        setUpload({
          data: parsed,
          source: {
            kind: 'upload',
            provider: 'Your file',
            label: file.name,
            detail: 'Parsed in this browser. Only the column names and five sample rows go to the model.',
            url: null,
            fetchedAt: new Date(),
          },
        })
        close()
        setSelectedDataset(CUSTOM)
        if (noticeParts.length > 0) setNotice(noticeParts.join(' '))
      } catch (err) {
        setFileError(err instanceof Error ? err.message : 'That file could not be read as CSV.')
      }
    }
    reader.onerror = () => {
      setFileError('Failed to read the file. Please try again.')
    }
    reader.readAsText(file)
  }

  const ask = (text: string, mode: AskMode) => {
    setLastAsk({ question: text, mode })
    void analysis.ask(text, mode)
  }

  const phase: HeaderStatus = isLoading ? 'running' : analysis.run ? analysis.run.outcome : 'idle'
  // On a phone the examples would push the run down, so they close when a run starts; the result is then brought into view.
  useResultFocus(phase, { onRunStart: (narrow) => narrow && setExamplesOpen(false) })
  const suggestions = choice?.questions ?? []
  const statusText = statusMessage(analysis, parsedData !== null)

  return (
    <div className="ds-app" data-run={phase}>
      <AppHeader status={phase} />

      <main className="ds-main">
        <Banners
          error={fileError}
          notice={notice}
          onDismissError={() => setFileError(null)}
          onDismissNotice={() => setNotice(null)}
        />

        <div className="ds-bench">
          <div className="ds-controls">
            <QueryBar
              parsedData={parsedData}
              datasetLabel={datasetLabel}
              question={question}
              suggestions={suggestions}
              examplesOpen={examplesOpen}
              onExamplesToggle={setExamplesOpen}
              isLoading={isLoading}
              statusText={statusText}
              onQuestionChange={setQuestion}
              onAnalyze={() => ask(question, 'new')}
              onStop={analysis.stop}
            />
            <DataSection
              options={options}
              selected={selectedDataset}
              cities={selectedDataset === 'weather' ? CITIES : null}
              cityId={cityId}
              state={datasetState}
              disabled={isLoading}
              fileInputRef={fileInputRef}
              onSelect={handleSelect}
              onCityChange={handleCityChange}
              onReload={handleReload}
              onUploadClick={() => fileInputRef.current?.click()}
              onFileChange={handleFileUpload}
            />
          </div>

          <RunColumn
            parsedData={parsedData}
            datasetLabel={datasetLabel}
            state={analysis}
            lastQuestion={lastAsk?.question ?? ''}
            onAskFollowUp={(text) => ask(text, 'follow-up')}
            onRetry={() => lastAsk && ask(lastAsk.question, lastAsk.mode)}
          />
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
