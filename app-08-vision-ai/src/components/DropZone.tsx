import React from 'react'
import { motion } from 'framer-motion'
import { Camera } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AnalysisMode } from '../lib/api'

interface DropZoneProps {
  modes: Array<{ id: AnalysisMode; label: string; icon: LucideIcon }>
  isDragging: boolean
  uploadError: string
  onPick: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export default function DropZone({
  modes,
  isDragging,
  uploadError,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
}: DropZoneProps) {
  return (
    <motion.div
      key="dropzone"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex items-center justify-center p-6"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-lg"
      >
        <button
          onClick={onPick}
          title="Choose an image to analyze (or drag one here, or paste with Ctrl+V)"
          aria-label="Choose an image to analyze"
          className={`w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-5 py-16 px-8 transition-all duration-300 cursor-pointer ${
            isDragging
              ? 'border-rose-500/60 bg-rose-500/[0.04]'
              : 'border-white/[0.08] hover:border-rose-500/30 hover:bg-white/[0.015]'
          }`}
        >
          <motion.div
            animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging ? 'bg-rose-500/15 ring-1 ring-rose-500/30' : 'bg-white/[0.04]'
            }`}
          >
            <Camera size={26} className={isDragging ? 'text-rose-400' : 'text-gray-600'} />
          </motion.div>

          <div className="text-center">
            <p className="text-base font-medium text-gray-200">Drop, paste, or click to upload</p>
            <p className="text-sm text-gray-600 mt-1">JPG, PNG, WebP, GIF up to 4MB</p>
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            {modes.map(({ id, label, icon: Icon }) => (
              <span
                key={id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-gray-600 text-xs"
              >
                <Icon size={11} />
                {label}
              </span>
            ))}
          </div>
        </button>

        {uploadError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-rose-400 text-sm text-center"
          >
            {uploadError}
          </div>
        )}

        <p className="text-center text-gray-700 text-xs mt-4">
          Powered by Claude Vision · Describe, analyze, extract, and query images with AI · Paste
          from clipboard supported
        </p>
      </motion.div>
    </motion.div>
  )
}
