import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart2, Zap, Info } from 'lucide-react'
import { parseCSV, executeQuery } from './lib/dataEngine'
import { validateQueryPlan } from './lib/queryPlan'
import { askData, CancelledError } from './lib/api'
import { SAMPLE_DATASETS, SAMPLE_QUERIES } from './lib/sampleData'
import AppHeader from './components/AppHeader'
import QueryBar from './components/QueryBar'
import Banners from './components/Banners'
import DataPreview from './components/DataPreview'
import HistoryRail from './components/HistoryRail'
import AnalysisPanel from './components/AnalysisPanel'
import ChartView from './components/ChartView'
import type { ParsedData, AnalysisResult, HistoryEntry, DatasetMeta } from './types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_HISTORY = 20
const RAIL_BREAKPOINT_PX = 900

const BASE_DATASETS: DatasetMeta[] = [
  {
    value: 'sales',
    label: 'Sales Performance',
    description: '50 rows · products, revenue, regions',
    icon: 'trending',
  },
  {
    value: 'analytics',
    label: 'User Analytics',
    description: '30 rows · signups, active users, churn',
    icon: 'users',
  },
  {
    value: 'weather',
    label: 'Weather Data',
    description: '40 rows · cities, temperature, humidity',
    icon: 'weather',
  },
  {
    value: 'custom',
    label: 'Custom Upload',
    description: 'Upload your own CSV file',
    icon: 'upload',
  },
]

function ChartSkeleton() {
  const bars = [55, 75, 42, 88, 62, 70, 48]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '12px',
        height: '280px',
        padding: '20px 16px',
      }}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          className="shimmer"
          style={{
            flex: 1,
            height: `${h}%`,
            borderRadius: '4px 4px 0 0',
            background: 'rgba(255,51,102,0.12)',
          }}
          animate={{ opacity: [0.3, 0.65, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

export default function App() {
  const [selectedDataset, setSelectedDataset] = useState<string>('sales')
  const [customFileName, setCustomFileName] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<ParsedData | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isRailOpen, setIsRailOpen] = useState<boolean>(
    () => typeof window === 'undefined' || window.innerWidth > RAIL_BREAKPOINT_PX,
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const datasets = useMemo<DatasetMeta[]>(
    () =>
      BASE_DATASETS.map((d) =>
        d.value === 'custom' && customFileName ? { ...d, description: customFileName } : d,
      ),
    [customFileName],
  )

  useEffect(() => {
    if (selectedDataset === 'custom') return
    const csv = SAMPLE_DATASETS[selectedDataset]
    if (!csv) return
    try {
      setParsedData(parseCSV(csv))
      setCurrentResult(null)
      setError(null)
      setNotice(null)
    } catch (err) {
      setParsedData(null)
      setError(
        err instanceof Error ? err.message : 'This sample dataset could not be loaded.',
      )
    }
  }, [selectedDataset])

  // Never leave a request in flight after the view goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleUploadClick = () => {
    // Selection only moves to "Custom Upload" once a file actually parses, so
    // cancelling the dialog leaves the current dataset (and its chip) untouched.
    fileInputRef.current?.click()
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    // Reset the input so re-selecting the same file triggers onChange
    e.target.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('That file is not a .csv. Please choose a comma-separated values file.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`File is too large (${file.size.toLocaleString()} bytes exceeds the 5 MB limit).`)
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
        setParsedData(parsed)
        setCurrentResult(null)
        setCustomFileName(file.name)
        setSelectedDataset('custom')
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
    setIsLoading(true)
    setError(null)

    try {
      const rawPlan = await askData(
        {
          question: asked,
          headers: parsedData.headers,
          sampleRows: parsedData.rows.slice(0, 5),
          rowCount: parsedData.rows.length,
        },
        { signal: controller.signal },
      )

      // Second gate: the function already validated, but a plan never reaches the
      // engine — and never renders as a chart — without matching this dataset.
      const validation = validateQueryPlan(rawPlan, parsedData.headers)
      if (!validation.ok) throw new Error(validation.error)

      const engineResult = executeQuery(parsedData, validation.plan)
      const result: AnalysisResult = { ...engineResult, queryPlan: validation.plan }
      setCurrentResult(result)
      setHistory((prev) =>
        [
          {
            id: Date.now().toString(),
            question: asked,
            dataset: datasets.find((d) => d.value === selectedDataset)?.label ?? selectedDataset,
            result,
            timestamp: new Date(),
          },
          ...prev,
        ].slice(0, MAX_HISTORY),
      )
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        setError(
          err instanceof Error ? err.message : 'Analysis failed. Try rephrasing your question.',
        )
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsLoading(false)
    }
  }

  const suggestedQueries = SAMPLE_QUERIES[selectedDataset] ?? []
  const warnings = currentResult?.warnings ?? []

  return (
    <div className="dp-shell">
      <AppHeader
        datasets={datasets}
        selected={selectedDataset}
        parsedData={parsedData}
        fileInputRef={fileInputRef}
        onSelect={setSelectedDataset}
        onUploadClick={handleUploadClick}
        onFileChange={handleFileUpload}
      />

      <div
        className="dp-blurb"
        style={{
          width: '100%',
          padding: '8px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(255,51,102,0.02)',
          flexShrink: 0,
        }}
      >
        <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.55, maxWidth: 860 }}>
          Load a CSV or pick one of the sample datasets, then ask questions like you're talking to a
          colleague. The AI figures out what you're looking for, crunches the numbers right in your
          browser, and draws the chart that tells the story.
        </p>
      </div>

      <div className="dp-body">
        <main className="dp-main">
          <QueryBar
            question={question}
            suggestions={suggestedQueries}
            isLoading={isLoading}
            hasData={Boolean(parsedData)}
            onQuestionChange={setQuestion}
            onAnalyze={() => void handleAnalyze()}
            onStop={handleStop}
          />

          <Banners
            error={error}
            notice={notice}
            onDismissError={() => setError(null)}
            onDismissNotice={() => setNotice(null)}
          />

          {parsedData && parsedData.headers.length > 0 && <DataPreview data={parsedData} />}

          <div
            style={{
              background: 'rgba(14,14,28,0.6)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              overflow: 'hidden',
              minHeight: '200px',
            }}
          >
            {isLoading ? (
              <div>
                <div
                  style={{
                    padding: '16px 20px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <motion.div
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Zap size={14} color="#ff3366" aria-hidden="true" />
                  </motion.div>
                  <span role="status" style={{ fontSize: '12px', color: '#4a4a6a' }}>
                    Analyzing data...
                  </span>
                </div>
                <ChartSkeleton />
              </div>
            ) : currentResult ? (
              <div>
                <div
                  style={{
                    padding: '16px 20px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontSize: '15px',
                      fontWeight: 600,
                      fontFamily: 'Syne, sans-serif',
                      color: '#f0f0fa',
                    }}
                  >
                    {currentResult.queryPlan.title}
                  </h2>
                  <span
                    title={`Rendered as a ${currentResult.queryPlan.chartType} chart`}
                    style={{
                      fontSize: '11px',
                      color: '#ff3366',
                      background: 'rgba(255,51,102,0.1)',
                      border: '1px solid rgba(255,51,102,0.2)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    {currentResult.queryPlan.chartType}
                  </span>
                </div>

                {warnings.length > 0 && (
                  <div
                    role="status"
                    style={{
                      margin: '12px 20px 0',
                      padding: '9px 12px',
                      background: 'rgba(255,170,0,0.07)',
                      border: '1px solid rgba(255,170,0,0.2)',
                      borderRadius: '8px',
                      color: '#ffbb44',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <span>{warnings.join(' ')}</span>
                  </div>
                )}

                <div style={{ padding: '8px 20px 16px' }}>
                  <ChartView result={currentResult} datasetRowCount={parsedData?.rows.length} />
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '240px',
                  gap: '12px',
                  color: '#4a4a6a',
                  padding: '24px',
                  textAlign: 'center',
                }}
              >
                <BarChart2 size={40} color="rgba(255,51,102,0.2)" aria-hidden="true" />
                <p style={{ margin: 0, fontSize: '14px' }}>
                  {parsedData
                    ? 'Ask a question to visualize your data'
                    : 'Select a dataset to get started'}
                </p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {currentResult && <AnalysisPanel result={currentResult} />}
          </AnimatePresence>
        </main>

        <HistoryRail
          history={history}
          isOpen={isRailOpen}
          onToggle={() => setIsRailOpen((o) => !o)}
          onSelect={(entry) => {
            setCurrentResult(entry.result)
            setQuestion(entry.question)
          }}
        />
      </div>

      <footer
        style={{
          textAlign: 'center',
          padding: '8px 0',
          fontSize: 11,
          color: '#4a4a6a',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}
      >
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
