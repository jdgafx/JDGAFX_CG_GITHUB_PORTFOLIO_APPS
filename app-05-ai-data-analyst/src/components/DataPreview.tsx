import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, Database } from 'lucide-react'
import type { ParsedData } from '../types'

const PREVIEW_ROWS = 10

export default function DataPreview({ data }: { data: ParsedData }) {
  const [isOpen, setIsOpen] = useState(false)
  const rows = data.rows.slice(0, PREVIEW_ROWS)

  return (
    <div
      style={{
        background: 'rgba(14,14,28,0.6)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        title={`Show the first ${PREVIEW_ROWS} rows of the loaded dataset`}
        aria-expanded={isOpen}
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
        <Database size={13} color="#ff3366" aria-hidden="true" />
        <span style={{ fontWeight: 500 }}>Data Preview</span>
        <span style={{ color: '#4a4a6a' }}>— {data.rows.length.toLocaleString()} rows</span>
        <div style={{ marginLeft: 'auto' }} aria-hidden="true">
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
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
                <caption className="sr-only">
                  First {rows.length} rows of the loaded dataset
                </caption>
                <thead>
                  <tr>
                    {data.headers.map((h) => (
                      <th
                        key={h}
                        scope="col"
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
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}
                    >
                      {data.headers.map((h) => (
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
  )
}
