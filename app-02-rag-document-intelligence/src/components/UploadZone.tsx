import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FileText, Upload, Loader2 } from 'lucide-react'
import { MAX_FILE_SIZE } from '../lib/constants'

interface UploadZoneProps {
  onFileSelect: (file: File) => void
  /** Validation problems are raised to the app so every error shares one surface. */
  onError: (message: string) => void
  isProcessing: boolean
}

export function UploadZone({ onFileSelect, onError, isProcessing }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    (file: File) => {
      const isValidType =
        file.type === 'application/pdf' ||
        file.type === 'text/plain' ||
        file.name.endsWith('.pdf') ||
        file.name.endsWith('.txt')

      if (!isValidType) {
        onError(
          `Unsupported file type: "${file.name.split('.').pop()?.toUpperCase() || 'unknown'}". Please upload a PDF or TXT file.`,
        )
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
        const limitMb = Math.round(MAX_FILE_SIZE / (1024 * 1024))
        onError(`File too large (${sizeMb} MB). Maximum allowed size is ${limitMb} MB.`)
        return
      }

      if (file.size === 0) {
        onError('This file appears to be empty.')
        return
      }

      onFileSelect(file)
    },
    [onFileSelect, onError],
  )

  const openPicker = useCallback(() => {
    if (!isProcessing) inputRef.current?.click()
  }, [isProcessing])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openPicker()
      }
    },
    [openPicker],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // Reset so re-picking the same file after an error still fires a change.
      e.target.value = ''
    },
    [handleFile],
  )

  const limitMb = Math.round(MAX_FILE_SIZE / (1024 * 1024))

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-2xl"
      >
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="inline-flex items-center gap-2 mb-4"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--color-accent-dim)', border: '1px solid var(--color-border-accent)' }}
            >
              <FileText size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
          </motion.div>
          <h1
            className="text-4xl font-bold mb-2 text-glow"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}
          >
            DocMind
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.05rem' }}>
            Upload a document. Ask anything. Get answers with source references.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          role="button"
          tabIndex={0}
          aria-label={`Upload a PDF or TXT document, up to ${limitMb} megabytes`}
          aria-busy={isProcessing}
          aria-disabled={isProcessing}
          title={isProcessing ? 'Reading your document...' : `Click, or press Enter, to choose a PDF or TXT file (max ${limitMb} MB)`}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className="relative cursor-pointer rounded-2xl p-12 flex flex-col items-center gap-5 transition-all duration-200 outline-none focus-visible:ring-2"
          style={{
            border: `2px dashed ${isDragging ? 'var(--color-accent)' : 'rgba(255,255,255,0.12)'}`,
            background: isDragging ? 'var(--color-accent-muted)' : 'var(--color-bg-card)',
            boxShadow: isDragging ? '0 0 32px var(--color-accent-dim)' : 'none',
          }}
        >
          {isProcessing ? (
            <>
              <Loader2
                size={48}
                className="animate-spin"
                style={{ color: 'var(--color-accent)' }}
              />
              <p style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                Extracting text...
              </p>
            </>
          ) : (
            <>
              <motion.div
                animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
                transition={{ type: 'spring', stiffness: 300 }}
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{
                  background: isDragging ? 'var(--color-accent-dim)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isDragging ? 'var(--color-border-accent)' : 'var(--color-border)'}`,
                }}
              >
                <Upload
                  size={32}
                  style={{ color: isDragging ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                />
              </motion.div>

              <div className="text-center">
                <p
                  className="text-lg font-medium mb-1"
                  style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
                >
                  {isDragging ? 'Drop it here' : 'Drop your document here'}
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                  or{' '}
                  <span style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>
                    browse files
                  </span>{' '}
                  · PDF and TXT supported
                </p>
              </div>

              <div className="flex gap-3">
                {(['PDF', 'TXT'] as const).map(fmt => (
                  <span
                    key={fmt}
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    title={`${fmt} files are supported`}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                      border: '1px solid var(--color-border-accent)',
                    }}
                  >
                    .{fmt.toLowerCase()}
                  </span>
                ))}
              </div>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,text/plain,application/pdf"
            className="hidden"
            tabIndex={-1}
            onChange={handleInputChange}
          />
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center mt-6 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          PDF parsing happens in your browser; only passages relevant to your question are sent to
          the AI model (max {limitMb} MB).
        </motion.p>
      </motion.div>
    </div>
  )
}
