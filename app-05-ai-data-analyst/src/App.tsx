import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart2,
  Upload,
  ChevronDown,
  ChevronUp,
  Search,
  Database,
  Clock,
  Zap,
  AlertCircle,
  TrendingUp,
  CloudRain,
  Users,
} from 'lucide-react'
import { parseCSV, executeQuery } from './lib/dataEngine'
import { askData } from './lib/api'
import { SAMPLE_DATASETS, SAMPLE_QUERIES } from './lib/sampleData'
import ChartView from './components/ChartView'
import type { ParsedData, AnalysisResult, HistoryEntry, DatasetMeta } from './types'

const DATASETS: DatasetMeta[] = [
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

function DatasetIcon({ icon }: { icon: string }) {
  const cls = 'w-4 h-4'
  if (icon === 'trending') return <TrendingUp className={cls} />
  if (icon === 'users') return <Users className={cls} />
  if (icon === 'weather') return <CloudRain className={cls} />
  return <Upload className={cls} />
}

function ChartSkeleton() {
  const bars = [55, 75, 42, 88, 62, 70, 48]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '12px',
        height: '320px',
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
  const [parsedData, setParsedData] = useState<ParsedData | null>(null)
  const [question, setQuestion] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [isTableOpen, setIsTableOpen] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedDataset === 'custom') return
    const csv = SAMPLE_DATASETS[selectedDataset]
    if (csv) {
      setParsedData(parseCSV(csv))
      setCurrentResult(null)
    }
  }, [selectedDataset])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      if (text) {
        const parsed = parseCSV(text)
        setParsedData(parsed)
        setCurrentResult(null)
      }
    }
    reader.readAsText(file)
  }

  const handleAnalyze = async () => {
    if (!parsedData || !question.trim() || isLoading) return
    setIsLoading(true)
    setError(null)
    try {
      const queryPlan = await askData({
        question,
        headers: parsedData.headers,
        sampleRows: parsedData.rows.slice(0, 5),
        rowCount: parsedData.rows.length,
      })
      const engineResult = executeQuery(parsedData, queryPlan)
      const result: AnalysisResult = { ...engineResult, queryPlan }
      setCurrentResult(result)
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        question,
        result,
        timestamp: new Date(),
      }
      setHistory((prev) => [entry, ...prev].slice(0, 20))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Try rephrasing your question.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleAnalyze()
  }

  const currentDataset = DATASETS.find((d) => d.value === selectedDataset)
  const suggestedQueries = SAMPLE_QUERIES[selectedDataset] ?? []
  const tableRows = parsedData?.rows.slice(0, 10) ?? []
  const tableHeaders = parsedData?.headers ?? []

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#08080f',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '0 24px',
          height: '56px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(8,8,15,0.95)',
          backdropFilter: 'blur(20px)',
          flexShrink: 0,
          position: 'relative',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '8px' }}>
          <div
            style={{
              width: '30px',
              height: '30px',
              background: 'rgba(255,51,102,0.15)',
              border: '1px solid rgba(255,51,102,0.3)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BarChart2 size={16} color="#ff3366" />
          </div>
          <span
            style={{
              fontFamily: 'Syne, sans-serif',
              fontWeight: 700,
              fontSize: '18px',
              color: '#f0f0fa',
              letterSpacing: '-0.02em',
            }}
          >
            Data<span style={{ color: '#ff3366' }}>Pilot</span>
          </span>
          <span style={{ fontSize: 11, color: '#4a4a6a', fontWeight: 400, marginLeft: 4 }}>Upload CSV data or use samples, ask questions in plain English, get instant charts.</span>
        </div>

        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setIsDropdownOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(14,14,28,0.8)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              padding: '7px 12px',
              color: '#f0f0fa',
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,51,102,0.3)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.07)')
            }
          >
            <Database size={13} color="#ff3366" />
            <span>{currentDataset?.label ?? 'Select Dataset'}</span>
            <ChevronDown size={13} color="#8a8aaa" />
          </button>

          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  background: '#0e0e1c',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '6px',
                  minWidth: '220px',
                  zIndex: 100,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                }}
              >
                {DATASETS.map((ds) => (
                  <button
                    key={ds.value}
                    onClick={() => {
                      if (ds.value === 'custom') {
                        setSelectedDataset('custom')
                        setIsDropdownOpen(false)
                        setTimeout(() => fileInputRef.current?.click(), 50)
                      } else {
                        setSelectedDataset(ds.value)
                        setIsDropdownOpen(false)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      width: '100%',
                      padding: '8px 10px',
                      background:
                        selectedDataset === ds.value ? 'rgba(255,51,102,0.1)' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: selectedDataset === ds.value ? '#ff3366' : '#f0f0fa',
                      fontFamily: 'DM Sans, sans-serif',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (selectedDataset !== ds.value)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          'rgba(255,255,255,0.04)'
                    }}
                    onMouseLeave={(e) => {
                      if (selectedDataset !== ds.value)
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                    }}
                  >
                    <div style={{ marginTop: '2px', color: '#ff3366', opacity: 0.8 }}>
                      <DatasetIcon icon={ds.icon} />
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{ds.label}</div>
                      <div style={{ fontSize: '11px', color: '#4a4a6a', marginTop: '1px' }}>
                        {ds.description}
                      </div>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {parsedData && (
          <div
            style={{
              fontSize: '11px',
              color: '#4a4a6a',
              padding: '3px 8px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '4px',
            }}
          >
            {parsedData.rows.length} rows · {parsedData.headers.length} columns
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
      </header>

      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div
            style={{
              background: 'rgba(14,14,28,0.7)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px',
              padding: '3px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocusCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = 'rgba(255,51,102,0.3)'
              el.style.boxShadow = '0 0 0 3px rgba(255,51,102,0.08), 0 4px 24px rgba(0,0,0,0.3)'
            }}
            onBlurCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = 'rgba(255,255,255,0.06)'
              el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ padding: '0 8px 0 14px', color: '#4a4a6a' }}>
              <Search size={16} />
            </div>
            <input
              type="text"
              placeholder="Ask about your data... e.g. 'Show total revenue by product as a bar chart'"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading || !parsedData}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f0f0fa',
                fontSize: '14px',
                fontFamily: 'DM Sans, sans-serif',
                padding: '12px 0',
              }}
            />
            <button
              onClick={() => void handleAnalyze()}
              disabled={isLoading || !parsedData || !question.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: isLoading || !parsedData || !question.trim() ? 'rgba(255,51,102,0.2)' : '#ff3366',
                border: 'none',
                borderRadius: '9px',
                padding: '9px 16px',
                color: isLoading || !parsedData || !question.trim() ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: 'DM Sans, sans-serif',
                cursor: isLoading || !parsedData || !question.trim() ? 'not-allowed' : 'pointer',
                margin: '3px',
                transition: 'background 0.2s, transform 0.1s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading && parsedData && question.trim())
                  (e.currentTarget as HTMLButtonElement).style.background = '#e82e5c'
              }}
              onMouseLeave={(e) => {
                if (!isLoading && parsedData && question.trim())
                  (e.currentTarget as HTMLButtonElement).style.background = '#ff3366'
              }}
            >
              {isLoading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Zap size={14} />
                </motion.div>
              ) : (
                <Zap size={14} />
              )}
              {isLoading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>

          {!isLoading && !currentResult && suggestedQueries.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
            >
              {suggestedQueries.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuestion(q)}
                  style={{
                    background: 'rgba(255,51,102,0.07)',
                    border: '1px solid rgba(255,51,102,0.18)',
                    borderRadius: '20px',
                    padding: '5px 12px',
                    color: '#8a8aaa',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLButtonElement
                    el.style.color = '#ff3366'
                    el.style.borderColor = 'rgba(255,51,102,0.4)'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLButtonElement
                    el.style.color = '#8a8aaa'
                    el.style.borderColor = 'rgba(255,51,102,0.18)'
                  }}
                >
                  {q}
                </button>
              ))}
            </motion.div>
          )}

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(255,68,68,0.1)',
                  border: '1px solid rgba(255,68,68,0.25)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  color: '#ff6666',
                  fontSize: '13px',
                }}
              >
                <AlertCircle size={15} />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {parsedData && tableHeaders.length > 0 && (
            <div
              style={{
                background: 'rgba(14,14,28,0.6)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setIsTableOpen((o) => !o)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#8a8aaa',
                  fontSize: '12px',
                  fontFamily: 'DM Sans, sans-serif',
                  textAlign: 'left',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#f0f0fa')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#8a8aaa')}
              >
                <Database size={13} color="#ff3366" />
                <span style={{ fontWeight: 500 }}>Data Preview</span>
                <span style={{ color: '#4a4a6a' }}>
                  — {parsedData.rows.length} rows
                </span>
                <div style={{ marginLeft: 'auto' }}>
                  {isTableOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              <AnimatePresence>
                {isTableOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ overflowX: 'auto', maxHeight: '240px', overflowY: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '12px',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        <thead>
                          <tr>
                            {tableHeaders.map((h) => (
                              <th
                                key={h}
                                style={{
                                  padding: '8px 16px',
                                  textAlign: 'left',
                                  background: 'rgba(255,51,102,0.12)',
                                  color: '#ff3366',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  letterSpacing: '0.04em',
                                  textTransform: 'uppercase',
                                  whiteSpace: 'nowrap',
                                  borderBottom: '1px solid rgba(255,51,102,0.2)',
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((row, i) => (
                            <tr
                              key={i}
                              style={{
                                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                              }}
                            >
                              {tableHeaders.map((h) => (
                                <td
                                  key={h}
                                  style={{
                                    padding: '7px 16px',
                                    color: '#8a8aaa',
                                    whiteSpace: 'nowrap',
                                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                                  }}
                                >
                                  {row[h] ?? '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

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
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}>
                    <Zap size={14} color="#ff3366" />
                  </motion.div>
                  <span style={{ fontSize: '12px', color: '#4a4a6a' }}>Analyzing data...</span>
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
                <div style={{ padding: '8px 20px 16px' }}>
                  <ChartView result={currentResult} />
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '280px',
                  gap: '12px',
                  color: '#4a4a6a',
                }}
              >
                <BarChart2 size={40} color="rgba(255,51,102,0.2)" />
                <p style={{ margin: 0, fontSize: '14px' }}>
                  {parsedData ? 'Ask a question to visualize your data' : 'Select a dataset to get started'}
                </p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {currentResult && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{
                  background: 'rgba(14,14,28,0.6)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Zap size={13} color="#ff3366" />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#8a8aaa', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      Analysis
                    </span>
                  </div>
                </div>
                <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: '#8a8aaa' }}>
                    {currentResult.queryPlan.explanation}
                  </p>
                  <div
                    style={{
                      background: 'rgba(8,8,15,0.8)',
                      border: '1px solid rgba(255,51,102,0.12)',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '11px',
                      color: '#4a4a6a',
                      overflowX: 'auto',
                      lineHeight: '1.7',
                    }}
                  >
                    <div style={{ color: '#ff3366', marginBottom: '6px', fontSize: '10px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      Query Plan
                    </div>
                    <pre style={{ margin: 0, color: '#6a6a8a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {JSON.stringify(
                        {
                          chartType: currentResult.queryPlan.chartType,
                          groupBy: currentResult.queryPlan.groupBy,
                          aggregate: currentResult.queryPlan.aggregate,
                          ...(currentResult.queryPlan.filter ? { filter: currentResult.queryPlan.filter } : {}),
                          ...(currentResult.queryPlan.sortBy ? { sortBy: currentResult.queryPlan.sortBy } : {}),
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <div style={{ color: '#4a4a6a', marginTop: '8px', fontSize: '10px' }}>
                      {currentResult.labels.length} groups · {currentResult.datasets[0]?.values.reduce((a, b) => a + b, 0).toLocaleString()} total
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside
          style={{
            width: '272px',
            flexShrink: 0,
            borderLeft: '1px solid rgba(255,255,255,0.04)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '16px 16px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            <Clock size={13} color="#4a4a6a" />
            <span style={{ fontSize: '11px', color: '#4a4a6a', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Query History
            </span>
            {history.length > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  color: '#4a4a6a',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '3px',
                  padding: '1px 5px',
                }}
              >
                {history.length}
              </span>
            )}
          </div>

          {history.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                color: '#4a4a6a',
                fontSize: '12px',
                padding: '20px',
                textAlign: 'center',
              }}
            >
              <Clock size={24} color="rgba(255,51,102,0.15)" />
              <span>Your analyzed queries will appear here</span>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              <AnimatePresence initial={false}>
                {history.map((entry) => (
                  <motion.button
                    key={entry.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={() => {
                      setCurrentResult(entry.result)
                      setQuestion(entry.question)
                    }}
                    style={{
                      width: '100%',
                      display: 'block',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      marginBottom: '6px',
                      fontFamily: 'DM Sans, sans-serif',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.background = 'rgba(255,51,102,0.07)'
                      el.style.borderColor = 'rgba(255,51,102,0.18)'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.background = 'rgba(255,255,255,0.02)'
                      el.style.borderColor = 'rgba(255,255,255,0.04)'
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#4a4a6a',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span
                        style={{
                          color: '#ff3366',
                          background: 'rgba(255,51,102,0.1)',
                          borderRadius: '3px',
                          padding: '1px 5px',
                          fontSize: '10px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {entry.result.queryPlan.chartType}
                      </span>
                      <span>{entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p
                      style={{
                        margin: '0 0 4px',
                        fontSize: '12px',
                        color: '#f0f0fa',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {entry.question}
                    </p>
                    <p style={{ margin: 0, fontSize: '11px', color: '#4a4a6a' }}>
                      {entry.result.labels.length} groups
                    </p>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </aside>
      </div>
      <footer style={{ textAlign: 'center', padding: '8px 0', fontSize: 11, color: '#4a4a6a', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
