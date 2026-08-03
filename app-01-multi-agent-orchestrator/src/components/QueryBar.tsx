import { ChevronRight, Square } from 'lucide-react'
import { EXAMPLE_QUERIES, MAX_QUERY_CHARS } from '../lib/agents'

interface QueryBarProps {
  query: string
  onQueryChange: (value: string) => void
  isRunning: boolean
  showExamples: boolean
  onStart: () => void
  onStop: () => void
  onExample: (text: string) => void
}

export function QueryBar({ query, onQueryChange, isRunning, showExamples, onStart, onStop, onExample }: QueryBarProps) {
  const canStart = isRunning || query.trim().length > 0

  return (
    <div
      style={{
        padding: '12px 20px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: '#111827',
        flexShrink: 0,
      }}
    >
      {showExamples && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Try one:</span>
          {EXAMPLE_QUERIES.map(example => (
            <button
              key={example}
              onClick={() => onExample(example)}
              title={`Run the pipeline on: ${example}`}
              className="example-chip"
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="text"
          value={query}
          onChange={event => onQueryChange(event.target.value.slice(0, MAX_QUERY_CHARS))}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) onStart()
          }}
          placeholder="Enter research query..."
          disabled={isRunning}
          maxLength={MAX_QUERY_CHARS}
          aria-label="Research query"
          title={`What should the agents research? Up to ${MAX_QUERY_CHARS} characters.`}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 16px',
            borderRadius: 12,
            background: 'rgba(17,24,39,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#f1f5f9',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={isRunning ? onStop : onStart}
          disabled={!canStart}
          aria-label={isRunning ? 'Stop research' : 'Start research'}
          title={isRunning ? 'Stop the run and keep whatever the agents produced' : 'Run all four agents on this query'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            cursor: canStart ? 'pointer' : 'not-allowed',
            background: isRunning ? 'rgba(255,51,102,0.12)' : 'rgba(0,212,255,0.1)',
            color: isRunning ? '#ff3366' : '#00d4ff',
            border: isRunning ? '1px solid rgba(255,51,102,0.3)' : '1px solid rgba(0,212,255,0.3)',
            transition: 'all 0.15s',
            opacity: canStart ? 1 : 0.5,
            fontFamily: 'inherit',
          }}
        >
          {isRunning ? (
            <>
              <Square size={13} aria-hidden="true" /> Stop
            </>
          ) : (
            <>
              <ChevronRight size={13} aria-hidden="true" /> Start Research
            </>
          )}
        </button>
      </div>
    </div>
  )
}
