import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import type { AnalysisMode } from '../lib/api'

export interface GalleryItem {
  id: string
  /** Small downscaled preview, or the full-size object URL as a fallback. */
  previewUrl: string
  file: File
  name: string
  mode: AnalysisMode
  result: string
  truncated: boolean
}

interface HistoryStripProps {
  items: GalleryItem[]
  activeId: string | null
  modeLabels: Record<AnalysisMode, string>
  atCapacity: boolean
  onSelect: (item: GalleryItem) => void
  onClear: () => void
}

export default function HistoryStrip({
  items,
  activeId,
  modeLabels,
  atCapacity,
  onSelect,
  onClear,
}: HistoryStripProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 border-t border-white/[0.06] bg-black/30 backdrop-blur-xl flex-shrink-0"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto">
        <span className="text-gray-700 text-xs flex-shrink-0">History</span>
        <div className="w-px h-4 bg-white/[0.06] flex-shrink-0" />

        {items.map(item => (
          <motion.button
            key={item.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(item)}
            className={`flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden transition-all duration-200 ${
              activeId === item.id
                ? 'ring-2 ring-rose-500 ring-offset-1 ring-offset-[#080810]'
                : 'ring-1 ring-white/[0.08] hover:ring-rose-500/40'
            }`}
            title={`Reopen ${item.name} · ${modeLabels[item.mode]}${item.truncated ? ' (truncated)' : ''}`}
            aria-label={`Reopen ${item.name}, analyzed in ${modeLabels[item.mode]} mode`}
          >
            <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
          </motion.button>
        ))}

        <div className="ml-auto flex items-center gap-3 flex-shrink-0 pl-3">
          {atCapacity && (
            <span className="hidden sm:block text-gray-700 text-xs">
              Keeps the last {items.length} — older entries drop off
            </span>
          )}
          <button
            onClick={onClear}
            title="Clear the analysis history"
            aria-label="Clear the analysis history"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] text-xs text-gray-500 hover:text-rose-400 transition-colors"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
