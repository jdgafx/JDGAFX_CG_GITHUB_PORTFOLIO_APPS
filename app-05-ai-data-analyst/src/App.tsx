import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { describeResult } from './lib/answer'
import { executeQuery, parseCSV, topGroup } from './lib/dataEngine'
import { answerDirection, applyQuestionDirection, validateQueryPlan } from './lib/queryPlan'
import { askData, AnalysisRunError, CancelledError, clientRun, sampleFor } from './lib/api'
import {
  CITIES,
  DATASET_CHOICES,
  DEFAULT_CITY,
  DEFAULT_DATASET,
} from './lib/liveData/catalog'
import { MAX_ROWS } from './lib/limits'
import { useLiveDataset, type DatasetState } from './hooks/useLiveDataset'
import AppHeader, { type HeaderStatus } from './components/AppHeader'
import DataSection from './components/DataSection'
import QueryBar from './components/QueryBar'
import Banners from './components/Banners'
import RunColumn from './components/RunColumn'
import type {
  AnalysisResult,
  DatasetOption,
  EngineResult,
  HistoryEntry,
  LoadedDataset,
  RunStep,
  RunView,
} from './types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_HISTORY = 20
const CUSTOM = 'custom'

/** The live status line. It uses the same verb as the primary button: Plan and run. */
function statusMessage(
  isLoading: boolean,
  run: RunView | null,
  current: AnalysisResult | null,
  hasData: boolean,
): string {
  if (isLoading) return 'Planning and running your question.'
  if (run?.outcome === 'done' && current) {
    const { notice, answer } = describeResult(
      current.queryPlan,
      topGroup(current, answerDirection(current.queryPlan)),
    )
    return `Plan and run complete. ${notice ?? answer ?? current.queryPlan.title}`
  }
  if (run?.outcome === 'failed') return 'Plan and run failed. The message at the top says why.'
  if (run?.outcome === 'stopped') return 'Plan and run stopped before a reply.'
  return hasData ? 'Type a question, then choose Plan and run.' : ''
}

export default function App() {
  const [selectedDataset, setSelectedDataset] = useState<string>(DEFAULT_DATASET)
  const [cityId, setCityId] = useState<string>(DEFAULT_CITY)
  const [upload, setUpload] = useState<LoadedDataset | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [current, setCurrent] = useState<AnalysisResult | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const choice = DATASET_CHOICES.find((item) => item.id === selectedDataset)
  const live = useLiveDataset(choice?.id ?? null, cityId)
  const datasetState: DatasetState =
    choice || !upload ? live.state : { status: 'ready', loaded: upload }
  const loaded = datasetState.status === 'ready' ? datasetState.loaded : null
  const parsedData = loaded?.data ?? null

  const options = useMemo<DatasetOption[]>(() => {
    const liveOptions = DATASET_CHOICES.map(({ id, label }) => ({ value: id, label: `${label} (live)` }))
    return upload ? [...liveOptions, { value: CUSTOM, label: upload.source.label }] : liveOptions
  }, [upload])
  const datasetLabel = loaded?.source.label ?? selectedDataset

  // Never leave a request in flight after the view goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  // A result belongs to the rows it was computed from, so it clears when those rows change.
  const clearResult = () => {
    setCurrent(null)
    setRun(null)
    setError(null)
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

      const plan = applyQuestionDirection(validation.plan, asked)
      const executeAt = Date.now()
      const engine: EngineResult = executeQuery(parsedData, plan)
      const direction = answerDirection(plan)
      const top = topGroup(engine, direction)
      const runStep: RunStep = {
        name: 'Run plan on the rows',
        status: 'ok',
        ms: Date.now() - executeAt,
        detail: top
          ? `${engine.labels.length} groups. ${direction === 'lowest' ? 'Lowest' : 'Highest'}: ${top.label}${top.tied.length > 1 ? ` and ${top.tied.length - 1} more tie` : ''}.`
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
        queryPlan: plan,
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
  const suggestions = choice?.questions ?? []
  const statusText = statusMessage(isLoading, run, current, parsedData !== null)

  return (
    <div className="ds-app">
      <AppHeader status={headerStatus} />

      <main className="ds-main">
        <Banners
          error={error}
          notice={notice}
          onDismissError={() => setError(null)}
          onDismissNotice={() => setNotice(null)}
        />

        <div className="ds-bench">
          <div className="ds-controls">
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
            <QueryBar
              parsedData={parsedData}
              question={question}
              suggestions={suggestions}
              isLoading={isLoading}
              statusText={statusText}
              onQuestionChange={setQuestion}
              onAnalyze={() => void handleAnalyze()}
              onStop={handleStop}
            />
          </div>

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
