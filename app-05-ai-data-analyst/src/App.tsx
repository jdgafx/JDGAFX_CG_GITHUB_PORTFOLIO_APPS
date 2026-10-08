import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { answerSentence } from './lib/answer'
import { executeQuery, parseCSV, topGroup } from './lib/dataEngine'
import { validateQueryPlan } from './lib/queryPlan'
import { askData, AnalysisRunError, CancelledError, clientRun, sampleFor } from './lib/api'
import { SAMPLE_DATASETS, SAMPLE_QUERIES } from './lib/sampleData'
import AppHeader, { type HeaderStatus } from './components/AppHeader'
import QueryBar from './components/QueryBar'
import Banners from './components/Banners'
import RunColumn from './components/RunColumn'
import type {
  AnalysisResult,
  DatasetOption,
  EngineResult,
  HistoryEntry,
  ParsedData,
  RunStep,
  RunView,
} from './types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_HISTORY = 20
const CUSTOM = 'custom'

const SAMPLE_OPTIONS: DatasetOption[] = [
  { value: 'sales', label: 'Sales performance' },
  { value: 'analytics', label: 'User analytics' },
  { value: 'weather', label: 'Weather data' },
]

/** The bundled samples are fixed text, so this only returns null if the bundle itself is broken. */
function loadSample(key: string): ParsedData | null {
  const csv = SAMPLE_DATASETS[key]
  if (!csv) return null
  try {
    return parseCSV(csv)
  } catch {
    return null
  }
}

/** The live status line. It uses the same verb as the primary button: Plan and run. */
function statusMessage(
  isLoading: boolean,
  run: RunView | null,
  current: AnalysisResult | null,
  hasData: boolean,
): string {
  if (isLoading) return 'Planning and running your question.'
  if (run?.outcome === 'done' && current) {
    const answer = answerSentence(current.queryPlan, topGroup(current))
    return `Plan and run complete. ${answer ?? current.queryPlan.title}`
  }
  if (run?.outcome === 'failed') return 'Plan and run failed. The message at the top says why.'
  if (run?.outcome === 'stopped') return 'Plan and run stopped before a reply.'
  return hasData ? 'Type a question, then choose Plan and run.' : ''
}

export default function App() {
  const [selectedDataset, setSelectedDataset] = useState<string>('sales')
  const [customData, setCustomData] = useState<ParsedData | null>(null)
  const [customFileName, setCustomFileName] = useState<string | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [current, setCurrent] = useState<AnalysisResult | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sampleData = useMemo(() => loadSample(selectedDataset), [selectedDataset])
  const parsedData = selectedDataset === CUSTOM ? customData : sampleData
  const sampleError =
    selectedDataset !== CUSTOM && parsedData === null
      ? 'This sample dataset could not be loaded. Reload the page, or upload your own CSV.'
      : null

  const options = useMemo<DatasetOption[]>(
    () => (customFileName ? [...SAMPLE_OPTIONS, { value: CUSTOM, label: customFileName }] : SAMPLE_OPTIONS),
    [customFileName],
  )
  const datasetLabel = options.find((option) => option.value === selectedDataset)?.label ?? selectedDataset

  // Never leave a request in flight after the view goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleSelect = (value: string) => {
    setSelectedDataset(value)
    setCurrent(null)
    setRun(null)
    setError(null)
    setNotice(null)
  }

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    // Reset the input so re-selecting the same file triggers onChange
    e.target.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('That file is not a .csv. Please choose a comma-separated values file.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('That file is larger than 5 MB. Choose a smaller CSV.')
      return
    }

    setError(null)
    setNotice(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = typeof evt.target?.result === 'string' ? evt.target.result : ''
      if (text.trim() === '') {
        setError(`"${file.name}" is empty. Choose a CSV with a header row and at least one data row.`)
        return
      }
      try {
        const parsed = parseCSV(text)
        const noticeParts: string[] = []
        if (parsed.truncated) {
          noticeParts.push(
            `Large file: charting the first 10,000 of ${parsed.totalRows?.toLocaleString()} rows.`,
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
        setCustomData(parsed)
        setCustomFileName(file.name)
        setCurrent(null)
        setRun(null)
        setSelectedDataset(CUSTOM)
        if (noticeParts.length > 0) setNotice(noticeParts.join(' '))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That file could not be read as CSV.')
      }
    }
    reader.onerror = () => {
      setError('Failed to read the file. Please try again.')
    }
    reader.readAsText(file)
  }

  const handleStop = () => abortRef.current?.abort()

  const handleAnalyze = async () => {
    const asked = question.trim()
    if (!parsedData || !asked || isLoading || abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    setIsLoading(true)
    setError(null)
    // The previous chart and figures belong to the last run, so they clear when a new run starts.
    setCurrent(null)
    setRun(null)

    try {
      const response = await askData(
        {
          question: asked,
          headers: parsedData.headers,
          sampleRows: sampleFor(parsedData),
          rowCount: parsedData.rows.length,
        },
        { signal: controller.signal },
      )

      // Second gate: the function already checked the plan, but a plan never reaches
      // the engine, and never renders as a chart, without matching this dataset.
      const checkAt = Date.now()
      const validation = validateQueryPlan(response.result, parsedData.headers)
      if (!validation.ok) {
        const step: RunStep = {
          name: 'Check plan in the browser',
          status: 'failed',
          ms: Date.now() - checkAt,
          detail: validation.error,
        }
        setRun({
          trace: [...response.trace, step],
          usage: response.usage,
          model: response.model,
          totalMs: response.totalMs,
          outcome: 'failed',
        })
        setError(validation.error)
        return
      }

      const executeAt = Date.now()
      const engine: EngineResult = executeQuery(parsedData, validation.plan)
      const top = topGroup(engine)
      const runStep: RunStep = {
        name: 'Run plan on the rows',
        status: 'ok',
        ms: Date.now() - executeAt,
        detail: top
          ? `${engine.labels.length} groups. Highest: ${top.label}.`
          : 'No rows matched, so there are no groups.',
      }
      const done: RunView = {
        trace: [...response.trace, runStep],
        usage: response.usage,
        model: response.model,
        totalMs: response.totalMs,
        outcome: 'done',
      }
      const result: AnalysisResult = {
        ...engine,
        queryPlan: validation.plan,
        question: asked,
        dataset: datasetLabel,
      }
      setCurrent(result)
      setRun(done)
      setHistory((prev) =>
        [{ id: String(Date.now()), result, run: done, timestamp: new Date() }, ...prev].slice(0, MAX_HISTORY),
      )
    } catch (err) {
      if (err instanceof CancelledError) {
        setRun({ ...clientRun('Stopped by you before a reply.', startedAt, 'skipped'), outcome: 'stopped' })
      } else if (err instanceof AnalysisRunError) {
        setRun({ ...err.run, outcome: 'failed' })
        setError(err.message)
      } else {
        const message = 'The analysis could not be completed. Please try again.'
        setRun({ ...clientRun(message, startedAt), outcome: 'failed' })
        setError(message)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsLoading(false)
    }
  }

  const handleReopen = (entry: HistoryEntry) => {
    setCurrent(entry.result)
    setRun(entry.run)
    setQuestion(entry.result.question)
  }

  const headerStatus: HeaderStatus = isLoading ? 'running' : run ? run.outcome : 'idle'
  const suggestions = SAMPLE_QUERIES[selectedDataset] ?? []
  const statusText = statusMessage(isLoading, run, current, parsedData !== null)

  return (
    <div className="ds-app">
      <AppHeader status={headerStatus} />

      <main className="ds-main">
        <Banners
          error={error ?? sampleError}
          notice={notice}
          onDismissError={() => setError(null)}
          onDismissNotice={() => setNotice(null)}
        />

        <div className="ds-bench">
          <QueryBar
            options={options}
            selected={selectedDataset}
            parsedData={parsedData}
            question={question}
            suggestions={suggestions}
            isLoading={isLoading}
            statusText={statusText}
            fileInputRef={fileInputRef}
            onSelect={handleSelect}
            onUploadClick={() => fileInputRef.current?.click()}
            onFileChange={handleFileUpload}
            onQuestionChange={setQuestion}
            onAnalyze={() => void handleAnalyze()}
            onStop={handleStop}
          />

          <RunColumn
            parsedData={parsedData}
            current={current}
            run={run}
            isLoading={isLoading}
            history={history}
            onReopen={handleReopen}
          />
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
