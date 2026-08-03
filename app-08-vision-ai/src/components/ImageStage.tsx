import React from 'react'
import { motion } from 'framer-motion'
import { ZoomIn, X } from 'lucide-react'

interface ImageStageProps {
  url: string
  label: string
  fileName: string
  isDragging: boolean
  uploadError: string
  onZoom: () => void
  onClear: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export default function ImageStage({
  url,
  label,
  fileName,
  isDragging,
  uploadError,
  onZoom,
  onClear,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageStageProps) {
  return (
    <div
      className="lg:flex-1 flex flex-col items-center justify-center p-5 min-h-[40vh] lg:min-h-0 relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="absolute inset-4 rounded-xl border-2 border-dashed border-rose-500/50 bg-rose-500/[0.04] flex items-center justify-center pointer-events-none z-10">
          <p className="text-rose-400 text-sm font-medium">Drop to replace image</p>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative group max-w-full"
      >
        <div
          role="button"
          tabIndex={0}
          title="Click to view this image full screen"
          aria-label="View image full screen"
          className="relative rounded-xl overflow-hidden cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          style={{
            boxShadow:
              '0 0 0 1px rgba(244,63,94,0.12), 0 0 60px rgba(244,63,94,0.08), 0 20px 60px rgba(0,0,0,0.5)',
          }}
          onClick={onZoom}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onZoom()
            }
          }}
        >
          <img
            src={url}
            alt={`Analysis target: ${label}`}
            className="max-w-full object-contain block"
            style={{ maxHeight: 'calc(100vh - 18rem)' }}
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
            <button
              title="View this image full screen"
              aria-label="View image full screen"
              className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center text-gray-300 hover:text-white transition-colors"
              onClick={e => {
                e.stopPropagation()
                onZoom()
              }}
            >
              <ZoomIn size={13} />
            </button>
            <button
              title="Remove this image and start over"
              aria-label="Remove this image"
              className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center text-gray-300 hover:text-rose-400 transition-colors"
              onClick={e => {
                e.stopPropagation()
                onClear()
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <p className="text-gray-700 text-xs mt-2 text-center truncate max-w-xs">{fileName}</p>
      </motion.div>

      {uploadError && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-rose-400 text-sm text-center max-w-md"
        >
          {uploadError}
        </div>
      )}
    </div>
  )
}
