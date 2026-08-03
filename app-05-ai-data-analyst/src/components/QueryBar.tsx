import { motion } from 'framer-motion'
import { Search, Zap, Square } from 'lucide-react'

interface QueryBarProps {
  question: string
  suggestions: string[]
  isLoading: boolean
  hasData: boolean
  onQuestionChange: (value: string) => void
  onAnalyze: () => void
  onStop: () => void
}

export default function QueryBar({
  question,
  suggestions,
  isLoading,
  hasData,
  onQuestionChange,
  onAnalyze,
  onStop,
}: QueryBarProps) {
  const canAnalyze = hasData && question.trim().length > 0 && !isLoading

  return (
    <>
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
        <div style={{ padding: '0 8px 0 14px', color: '#4a4a6a' }} aria-hidden="true">
          <Search size={16} />
        </div>
        <input
          type="text"
          placeholder="Ask about your data... e.g. 'Show total revenue by product as a bar chart'"
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAnalyze()
          }}
          disabled={isLoading || !hasData}
          aria-label="Ask a question about your data"
          title="Describe what you want to see — the AI turns it into a chart"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#f0f0fa',
            fontSize: '14px',
            fontFamily: 'DM Sans, sans-serif',
            padding: '12px 0',
          }}
        />
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop this analysis"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,51,102,0.15)',
              border: '1px solid rgba(255,51,102,0.35)',
              borderRadius: '9px',
              padding: '9px 16px',
              color: '#ff6b9d',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'DM Sans, sans-serif',
              cursor: 'pointer',
              margin: '3px',
              whiteSpace: 'nowrap',
            }}
          >
            <Square size={12} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onAnalyze}
            disabled={!canAnalyze}
            title={
              !hasData
                ? 'Load a dataset first'
                : question.trim()
                  ? 'Analyze your question and draw the chart'
                  : 'Type a question first'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: canAnalyze ? '#ff3366' : 'rgba(255,51,102,0.2)',
              border: 'none',
              borderRadius: '9px',
              padding: '9px 16px',
              color: canAnalyze ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'DM Sans, sans-serif',
              cursor: canAnalyze ? 'pointer' : 'not-allowed',
              margin: '3px',
              whiteSpace: 'nowrap',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              if (canAnalyze) (e.currentTarget as HTMLButtonElement).style.background = '#e82e5c'
            }}
            onMouseLeave={(e) => {
              if (canAnalyze) (e.currentTarget as HTMLButtonElement).style.background = '#ff3366'
            }}
          >
            <Zap size={14} aria-hidden="true" />
            Analyze
          </button>
        )}
      </div>

      {!isLoading && suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
        >
          {suggestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onQuestionChange(q)}
              title="Use this example question"
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
    </>
  )
}
