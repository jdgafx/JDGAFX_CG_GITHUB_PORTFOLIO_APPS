import { motion } from 'framer-motion'
import { Globe, Search } from 'lucide-react'
import type { FieldKey, FieldValues, PageContentType, ResultRow, StepAction } from '../types'

interface MockPageProps {
  pageContent?: PageContentType
  currentAction: StepAction
  activeField: FieldKey | null
  fields: FieldValues
  rows: ResultRow[]
}

function InputBox({ label, value, placeholder, active, typing }: {
  label: string
  value?: string
  placeholder: string
  active: boolean
  typing: boolean
}) {
  return (
    <div
      className={`bg-slate-600/60 rounded-lg px-3 py-2 border ${
        active ? 'border-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.3)]' : 'border-slate-500/30'
      }`}
    >
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-sm font-mono min-h-5">
        <span className={value ? 'text-white' : 'text-slate-500'}>{value || placeholder}</span>
        {typing && <span className="cursor-blink text-teal-400">|</span>}
      </div>
    </div>
  )
}

/** Rows of extracted data, or neutral placeholders when the scenario has not produced any. */
function ResultRows({ rows, highlight }: { rows: ResultRow[]; highlight: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-slate-700/40 rounded-lg p-3 border border-slate-600/20 space-y-2">
            <div className="h-3 bg-slate-600/40 rounded w-1/2" />
            <div className="h-3 bg-slate-600/20 rounded w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <motion.div
          key={`${row.title}-${i}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className={`bg-slate-700/60 rounded-lg p-3 flex items-center justify-between gap-3 border ${
            i === 0 && highlight
              ? 'border-teal-500/60 shadow-[0_0_12px_rgba(20,184,166,0.2)]'
              : 'border-slate-600/30'
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{row.title}</div>
            {row.detail && <div className="text-xs text-slate-400 truncate">{row.detail}</div>}
          </div>
          {row.value && <div className="text-base font-bold text-white flex-shrink-0">{row.value}</div>}
        </motion.div>
      ))}
    </div>
  )
}

const FORM_FIELDS: Array<{ label: string; key: FieldKey }> = [
  { label: 'Full Name', key: 'name' },
  { label: 'Email', key: 'email' },
  { label: 'Phone', key: 'phone' },
  { label: 'Experience', key: 'experience' },
]

export default function MockPageContent({ pageContent, currentAction, activeField, fields, rows }: MockPageProps) {
  const isTyping = currentAction === 'type'
  const typingIn = (key: FieldKey) => isTyping && activeField === key

  if (pageContent === 'flights-search' || pageContent === 'flights-results') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
          <div className="flex gap-2 mb-2">
            {['Flights', 'Hotels', 'Car Hire', 'Holidays'].map((tab) => (
              <div
                key={tab}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  tab === 'Flights'
                    ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                    : 'text-slate-400'
                }`}
              >
                {tab}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <InputBox
              label="From"
              value={fields.origin}
              placeholder="Departure city"
              active={activeField === 'origin'}
              typing={typingIn('origin')}
            />
            <InputBox
              label="To"
              value={fields.destination}
              placeholder="Destination city"
              active={activeField === 'destination'}
              typing={typingIn('destination')}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <InputBox
                label="Date"
                value={fields.date}
                placeholder="Select date"
                active={activeField === 'date'}
                typing={typingIn('date')}
              />
            </div>
            <div
              className={`rounded-lg px-4 py-2 flex items-center gap-2 text-white text-sm font-semibold ${
                currentAction === 'click' ? 'bg-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.5)]' : 'bg-teal-500'
              }`}
            >
              <Search size={14} />
              Search
            </div>
          </div>
        </div>

        {pageContent === 'flights-results' && (
          <ResultRows rows={rows} highlight={currentAction === 'extract' || currentAction === 'verify'} />
        )}
      </div>
    )
  }

  if (pageContent === 'job-board' || pageContent === 'job-results') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
          <div className="flex gap-2 mb-2">
            {['All Jobs', 'Remote', 'Full-time', 'Contract'].map((tab) => (
              <div
                key={tab}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  tab === 'All Jobs'
                    ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                    : 'text-slate-400'
                }`}
              >
                {tab}
              </div>
            ))}
          </div>
          <div className={`bg-slate-600/60 rounded-lg px-3 py-2 border ${
            currentAction === 'find' || isTyping
              ? 'border-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.3)]'
              : 'border-slate-500/30'
          }`}>
            <div className="flex items-center gap-2">
              <Search size={14} className="text-slate-400" />
              <span className="text-sm font-mono">
                <span className={fields.search ? 'text-white' : 'text-slate-500'}>
                  {fields.search || 'Search jobs...'}
                </span>
                {typingIn('search') && <span className="cursor-blink text-teal-400">|</span>}
              </span>
            </div>
          </div>
        </div>

        {pageContent === 'job-results' && (
          <ResultRows rows={rows} highlight={currentAction === 'extract' || currentAction === 'verify'} />
        )}
      </div>
    )
  }

  if (pageContent === 'ecommerce' || pageContent === 'ecommerce-results') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-xl p-3 flex items-center gap-2">
          <Search size={14} className="text-slate-400" />
          <span className="text-sm font-mono">
            <span className={fields.search ? 'text-slate-200' : 'text-slate-500'}>
              {fields.search || 'Search products...'}
            </span>
            {typingIn('search') && <span className="cursor-blink text-teal-400">|</span>}
          </span>
        </div>
        {pageContent === 'ecommerce-results' ? (
          <ResultRows rows={rows} highlight={currentAction === 'extract' || currentAction === 'verify'} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-slate-700/40 rounded-lg p-3 border border-slate-600/20">
                <div className="h-16 bg-slate-600/40 rounded mb-2" />
                <div className="h-3 bg-slate-600/30 rounded w-3/4 mb-1" />
                <div className="h-3 bg-slate-600/20 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (pageContent === 'form') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium text-white mb-2">Application Form</div>
          {FORM_FIELDS.map((field) => (
            <InputBox
              key={field.key}
              label={field.label}
              value={fields[field.key]}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              active={activeField === field.key}
              typing={typingIn(field.key)}
            />
          ))}
          <div
            className={`rounded-lg px-4 py-2 text-center text-white text-sm font-semibold mt-2 ${
              currentAction === 'click' ? 'bg-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.5)]' : 'bg-teal-500'
            }`}
          >
            Submit
          </div>
        </div>
      </div>
    )
  }

  if (pageContent === 'search-results') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
          <Search size={14} className="text-slate-400" />
          <span className="text-sm">
            <span className={fields.search ? 'text-slate-200' : 'text-slate-500'}>
              {fields.search || 'Search...'}
            </span>
            {typingIn('search') && <span className="cursor-blink text-teal-400">|</span>}
          </span>
        </div>
        <ResultRows rows={rows} highlight={currentAction === 'extract' || currentAction === 'verify'} />
      </div>
    )
  }

  if (rows.length > 0) {
    return (
      <div className="p-4 space-y-3">
        <ResultRows rows={rows} highlight={currentAction === 'extract' || currentAction === 'verify'} />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="bg-slate-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
        <Globe size={14} className="text-slate-400" />
        <span className="text-xs text-slate-400 font-mono truncate">Loading page content...</span>
      </div>
      <div className="bg-slate-700/40 rounded-xl p-4 space-y-2">
        <div className="h-4 bg-slate-600/40 rounded w-2/3" />
        <div className="h-3 bg-slate-600/30 rounded w-full" />
        <div className="h-3 bg-slate-600/30 rounded w-5/6" />
        <div className="h-3 bg-slate-600/20 rounded w-3/4" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[1, 2].map((i) => (
          <div key={i} className="bg-slate-700/30 rounded-lg p-3 h-20" />
        ))}
      </div>
    </div>
  )
}
