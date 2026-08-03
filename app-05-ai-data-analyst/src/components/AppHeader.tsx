import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, ChevronDown, Database, TrendingUp, CloudRain, Users } from 'lucide-react'
import type { DatasetMeta, ParsedData } from '../types'

interface AppHeaderProps {
  datasets: DatasetMeta[]
  selected: string
  parsedData: ParsedData | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (value: string) => void
  onUploadClick: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function DatasetIcon({ icon }: { icon: string }) {
  const cls = 'w-4 h-4'
  if (icon === 'trending') return <TrendingUp className={cls} />
  if (icon === 'users') return <Users className={cls} />
  if (icon === 'weather') return <CloudRain className={cls} />
  return <Upload className={cls} />
}

export default function AppHeader({
  datasets,
  selected,
  parsedData,
  fileInputRef,
  onSelect,
  onUploadClick,
  onFileChange,
}: AppHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen((open) => {
          if (open) triggerRef.current?.focus()
          return false
        })
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const current = datasets.find((d) => d.value === selected)

  return (
    <header className="dp-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '8px' }}>
        <div
          aria-hidden="true"
          style={{
            width: '30px',
            height: '30px',
            background: 'rgba(255,51,102,0.15)',
            border: '1px solid rgba(255,51,102,0.3)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="3" y="18" width="5" height="11" rx="1.5" fill="#ff3366" opacity="0.5" />
            <rect x="10" y="12" width="5" height="17" rx="1.5" fill="#ff3366" opacity="0.7" />
            <rect x="17" y="6" width="5" height="23" rx="1.5" fill="#ff3366" />
            <rect x="24" y="14" width="5" height="15" rx="1.5" fill="#ff6b9d" opacity="0.6" />
            <path
              d="M5 17L12 11L19 5L27 13"
              stroke="#ffd700"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="5" cy="17" r="2" fill="#ffd700" />
            <circle cx="19" cy="5" r="2" fill="#ffd700" />
          </svg>
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: '18px',
            color: '#f0f0fa',
            letterSpacing: '-0.02em',
          }}
        >
          Data<span style={{ color: '#ff3366' }}>Pilot</span>
        </h1>
        <span style={{ fontSize: 11, color: '#4a4a6a', fontWeight: 400, marginLeft: 4 }}>
          AI Data Analyst
        </span>
      </div>

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          title="Choose a sample dataset or upload your own CSV"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={`Dataset: ${current?.label ?? 'none selected'}. Choose a dataset`}
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
          <Database size={13} color="#ff3366" aria-hidden="true" />
          <span>{current?.label ?? 'Select Dataset'}</span>
          <ChevronDown size={13} color="#8a8aaa" aria-hidden="true" />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              role="menu"
              aria-label="Datasets"
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
              {datasets.map((ds) => (
                <button
                  key={ds.value}
                  type="button"
                  role="menuitem"
                  title={ds.description}
                  onClick={() => {
                    setIsOpen(false)
                    if (ds.value === 'custom') onUploadClick()
                    else onSelect(ds.value)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 10px',
                    background: selected === ds.value ? 'rgba(255,51,102,0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: selected === ds.value ? '#ff3366' : '#f0f0fa',
                    fontFamily: 'DM Sans, sans-serif',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (selected !== ds.value)
                      (e.currentTarget as HTMLButtonElement).style.background =
                        'rgba(255,255,255,0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (selected !== ds.value)
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                >
                  <div style={{ marginTop: '2px', color: '#ff3366', opacity: 0.8 }} aria-hidden="true">
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

      <button
        type="button"
        onClick={onUploadClick}
        title="Upload a CSV file from your computer (max 5 MB)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          background: 'rgba(255,51,102,0.08)',
          border: '1px solid rgba(255,51,102,0.22)',
          borderRadius: '8px',
          padding: '7px 12px',
          color: '#ff6b9d',
          fontSize: '13px',
          cursor: 'pointer',
          fontFamily: 'DM Sans, sans-serif',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'rgba(255,51,102,0.16)'
          el.style.borderColor = 'rgba(255,51,102,0.4)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'rgba(255,51,102,0.08)'
          el.style.borderColor = 'rgba(255,51,102,0.22)'
        }}
      >
        <Upload size={13} aria-hidden="true" />
        <span>Upload CSV</span>
      </button>

      {parsedData && (
        <div
          title={`${parsedData.rows.length.toLocaleString()} rows loaded across ${parsedData.headers.length} columns`}
          style={{
            fontSize: '11px',
            color: parsedData.truncated ? '#ffaa00' : '#4a4a6a',
            padding: '3px 8px',
            background: parsedData.truncated ? 'rgba(255,170,0,0.08)' : 'rgba(255,255,255,0.04)',
            borderRadius: '4px',
          }}
        >
          {parsedData.rows.length.toLocaleString()} rows · {parsedData.headers.length} columns
          {parsedData.truncated && ` (of ${parsedData.totalRows?.toLocaleString()})`}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Upload a CSV file"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
    </header>
  )
}
