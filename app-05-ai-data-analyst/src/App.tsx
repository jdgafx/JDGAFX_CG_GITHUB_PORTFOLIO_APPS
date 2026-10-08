import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { executeQuery, parseCSV, topGroup } from './lib/dataEngine'
import { validateQueryPlan } from './lib/queryPlan'
import { askData, AnalysisRunError, CancelledError, clientRun } from './lib/api'
import { SAMPLE_DATASETS, SAMPLE_QUERIES } from './lib/sampleData'
import AppHeader, { type HeaderStatus } from './components/AppHeader'
import QueryBar from './components/QueryBar'
import Banners from './components/Banners'
import DataPreview from './components/DataPreview'
import AnalysisPanel from './components/AnalysisPanel'
import RunTrace from './components/RunTrace'
import RunMetrics from './components/RunMetrics'
import HistoryList from './components/HistoryList'
import type {
  AnalysisResult,
  DatasetOption,
  EngineResult,
  HistoryEntry,
  ParsedData,
  RunOutcome,
  RunStep,
  RunView,
} from './types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_HISTORY = 20
const SAMPLE_ROWS = 5
const CUSTOM = 'custom'

const SAMPLE_OPTIONS: DatasetOption[] = [
  { value: 'sales', label: 'Sales Performance' },
  { value: 'analytics', label: 'User Analytics' },
  { value: 'weather', label: 'Weather Data' },
]

const OUTCOME: Record<RunOutcome, { label: string; tone: string }> = {
  done: { label: 'Completed', tone: 'ds-badge--success' },
  failed: { label: 'Failed', tone: 'ds-badge--danger' },
  stopped: { label: 'Stopped', tone: '' },
}

export default function App() {
  const [selectedDataset, setSelectedDataset] = useState<string>('sales')
  const [customData, setCustomData] = useState<ParsedData | null>(null)
  const [customFileName, setCustomFileName] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<ParsedData | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [current, setCurrent] = useState<AnalysisResult | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const options = useMemo<DatasetOption[]>(
    () => (customFileName ? [...SAMPLE_OPTIONS, { value: CUSTOM, label: customFileName }] : SAMPLE_OPTIONS),
    [customFileName],
  )
  const datasetLabel = options.find((option) => option.value === selectedDataset)?.label ?? selectedDataset

  // Loads the chosen dataset. The previous result is cleared in handleSelect instead,
  // so a finished upload keeps the notice it just set.
  useEffect(() => {
    if (selectedDataset === CUSTOM) {
      setParsedData(customData)
      return
    }
    const csv = SAMPLE_DATASETS[selectedDataset]
    if (!csv) return
    try {
      setParsedData(parseCSV(csv))
    } catch (err) {
      setParsedData(null)
      setError(err instanceof Error ? err.message : 'This sample dataset could not be loaded.')
    }
  }, [selectedDataset, customData])

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

    try {
      const response = await askData(
        {
          question: asked,
          headers: parsedData.headers,
          sampleRows: parsedData.rows.slice(0, SAMPLE_ROWS),
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
        const message = err instanceof Error ? err.message : 'Analysis failed. Try rephrasing your question.'
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
  const liveText = isLoading
    ? 'Analyzing your question.'
    : run?.outcome === 'done' && current
      ? `Chart updated: ${current.queryPlan.title}.`
      : run?.outcome === 'failed'
        ? 'The analysis failed.'
        : run?.outcome === 'stopped'
          ? 'Analysis stopped.'
          : ''

  return (
    <div className="ds-app">
      <AppHeader status={headerStatus} />

      <main className="ds-main">
        <QueryBar
          options={options}
          selected={selectedDataset}
          parsedData={parsedData}
          question={question}
          suggestions={suggestions}
          isLoading={isLoading}
          fileInputRef={fileInputRef}
          onSelect={handleSelect}
          onUploadClick={() => fileInputRef.current?.click()}
          onFileChange={handleFileUpload}
          onQuestionChange={setQuestion}
          onAnalyze={() => void handleAnalyze()}
          onStop={handleStop}
        />

        {parsedData && parsedData.headers.length > 0 && <DataPreview data={parsedData} />}

        <Banners
          error={error}
          notice={notice}
          onDismissError={() => setError(null)}
          onDismissNotice={() => setNotice(null)}
        />

        <p className="ds-hint" role="status" aria-live="polite">
          {liveText}
        </p>

        <div className="ds-grid-2">
          {isLoading ? (
            <section className="ds-card" aria-busy="true" aria-label="Analysis in progress">
              <div className="app-skeleton" />
            </section>
          ) : current ? (
            <AnalysisPanel result={current} />
          ) : (
            <section className="ds-card">
              <p className="ds-empty">
                {parsedData
                  ? 'Ask a question to draw a chart from your data.'
                  : 'Choose a sample dataset or upload a CSV to start.'}
              </p>
            </section>
          )}

          <section className="ds-card" aria-labelledby="run-title">
            <div className="ds-card__head">
              <h2 id="run-title" className="ds-card__title">Agent run</h2>
              {run && <span className={`ds-badge ${OUTCOME[run.outcome].tone}`}>{OUTCOME[run.outcome].label}</span>}
            </div>
            {run ? (
              <div className="app-stack">
                <p className="ds-hint">
                  Each step shows what it did and how long it took. Steps that did not run are marked skipped.
                </p>
                <RunTrace steps={run.trace} />
                <RunMetrics run={run} />
              </div>
            ) : (
              <p className="ds-empty">Ask a question to see each step, its timing and the token use.</p>
            )}
          </section>
        </div>

        <HistoryList entries={history} disabled={isLoading} onReopen={handleReopen} />
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
