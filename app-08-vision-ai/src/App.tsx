import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Eye, BarChart2, MessageSquare, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  analyzeImage,
  isCancellation,
  ACCEPTED_LABEL,
  ACCEPTED_TYPES,
  MAX_FILE_SIZE,
} from './lib/api'
import type { AnalysisMode } from './lib/api'
import { createThumbnailUrl } from './lib/image'
import AnalysisPanel from './components/AnalysisPanel'
import DropZone from './components/DropZone'
import ImageStage from './components/ImageStage'
import HistoryStrip from './components/HistoryStrip'
import type { GalleryItem } from './components/HistoryStrip'
import ZoomOverlay from './components/ZoomOverlay'

const MODES: Array<{ id: AnalysisMode; label: string; icon: LucideIcon }> = [
  { id: 'describe', label: 'Describe', icon: Eye },
  { id: 'analyze', label: 'Analyze', icon: BarChart2 },
  { id: 'qa', label: 'Q&A', icon: MessageSquare },
  { id: 'extract', label: 'Extract', icon: FileText },
]

const MODE_LABELS: Record<AnalysisMode, string> = {
  describe: 'Describe',
  analyze: 'Analyze',
  qa: 'Q&A',
  extract: 'Extract',
}

const HISTORY_LIMIT = 12

export default function App() {
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [currentUrl, setCurrentUrl] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('describe')
  const [question, setQuestion] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [analysisText, setAnalysisText] = useState('')
  const [isTruncated, setIsTruncated] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [noticeText, setNoticeText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const analysisRef = useRef<HTMLDivElement>(null)
  const accTextRef = useRef('')
  const currentUrlRef = useRef('')
  const galleryRef = useRef<GalleryItem[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const el = analysisRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [analysisText])

  // Release every object URL this component owns when it goes away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current)
      for (const item of galleryRef.current) URL.revokeObjectURL(item.previewUrl)
    }
  }, [])

  const setDisplayedImage = useCallback((file: File) => {
    if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current)
    const url = URL.createObjectURL(file)
    currentUrlRef.current = url
    setCurrentUrl(url)
    setCurrentFile(file)
  }, [])

  const resetResults = useCallback(() => {
    accTextRef.current = ''
    setAnalysisText('')
    setIsTruncated(false)
    setErrorText('')
    setNoticeText('')
  }, [])

  const loadFile = useCallback(
    (file: File) => {
      setUploadError('')

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setUploadError(
          `Unsupported file type: ${file.type || 'unknown'}. Please use ${ACCEPTED_LABEL}.`,
        )
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        setUploadError(`Image is too large (${sizeMB}MB). Maximum size is 4MB.`)
        return
      }

      setDisplayedImage(file)
      resetResults()
      setQuestionError('')
      setActiveGalleryId(null)
    },
    [resetResults, setDisplayedImage],
  )

  // Clipboard paste support (Ctrl+V / Cmd+V for screenshots)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) loadFile(file)
          return
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [loadFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) loadFile(file)
      // Allow re-selecting the same file after a clear.
      e.target.value = ''
    },
    [loadFile],
  )

  const clearImage = useCallback(() => {
    abortRef.current?.abort()
    if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current)
    currentUrlRef.current = ''
    setCurrentUrl('')
    setCurrentFile(null)
    setActiveGalleryId(null)
    setUploadError('')
    setQuestionError('')
    resetResults()
  }, [resetResults])

  const addToGallery = useCallback(async (file: File, item: Omit<GalleryItem, 'previewUrl'>) => {
    const previewUrl = (await createThumbnailUrl(file)) ?? URL.createObjectURL(file)
    const previous = galleryRef.current
    const next = [{ ...item, previewUrl }, ...previous].slice(0, HISTORY_LIMIT)
    for (const dropped of previous) {
      if (!next.includes(dropped)) URL.revokeObjectURL(dropped.previewUrl)
    }
    galleryRef.current = next
    setGallery(next)
  }, [])

  const clearGallery = useCallback(() => {
    for (const item of galleryRef.current) URL.revokeObjectURL(item.previewUrl)
    galleryRef.current = []
    setGallery([])
    setActiveGalleryId(null)
  }, [])

  const handleAnalyze = useCallback(() => {
    if (!currentFile || isLoading) return

    if (mode === 'qa' && !question.trim()) {
      setQuestionError('Enter a question before running a Q&A analysis.')
      return
    }

    setQuestionError('')
    setUploadError('')
    resetResults()
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    const file = currentFile
    const runMode = mode
    let truncated = false

    void analyzeImage({
      file,
      mode: runMode,
      question: runMode === 'qa' ? question : undefined,
      signal: controller.signal,
      onChunk: text => {
        accTextRef.current += text
        setAnalysisText(accTextRef.current)
      },
      onTruncated: () => {
        truncated = true
        setIsTruncated(true)
      },
      onComplete: () => {
        setIsLoading(false)
        abortRef.current = null
        void addToGallery(file, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          mode: runMode,
          result: accTextRef.current,
          truncated,
        })
      },
      onError: err => {
        setIsLoading(false)
        abortRef.current = null
        // Keep whatever streamed before the failure; the notice explains the gap.
        if (isCancellation(err)) {
          setNoticeText('Analysis cancelled. Anything above is only a partial result.')
        } else {
          setErrorText(err.message)
        }
      },
    })
  }, [addToGallery, currentFile, isLoading, mode, question, resetResults])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleModeChange = useCallback(
    (next: AnalysisMode) => {
      if (next === mode) return
      setMode(next)
      setQuestionError('')
      // The previous answer belongs to the previous mode.
      resetResults()
      setActiveGalleryId(null)
    },
    [mode, resetResults],
  )

  const loadGalleryItem = useCallback(
    (item: GalleryItem) => {
      abortRef.current?.abort()
      setDisplayedImage(item.file)
      setMode(item.mode)
      setQuestionError('')
      setUploadError('')
      accTextRef.current = item.result
      setAnalysisText(item.result)
      setIsTruncated(item.truncated)
      setErrorText('')
      setNoticeText('')
      setActiveGalleryId(item.id)
    },
    [setDisplayedImage],
  )

  const hasImage = Boolean(currentUrl)
  const imageLabel = currentFile?.name ?? 'the uploaded image'

  return (
    <div className="min-h-screen bg-[#080810] flex flex-col text-white">
      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 85% 0%, rgba(244,63,94,0.07) 0%, transparent 65%), radial-gradient(ellipse 60% 40% at 15% 100%, rgba(244,63,94,0.04) 0%, transparent 65%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 h-12 flex items-center px-5 border-b border-white/[0.06] bg-black/30 backdrop-blur-2xl flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-rose-500/15 ring-1 ring-rose-500/25 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M2 16S7 6 16 6s14 10 14 10-5 10-14 10S2 16 2 16z" stroke="#f43f5e" strokeWidth="1.5" fill="#f43f5e" fillOpacity="0.08"/>
              <circle cx="16" cy="16" r="6" stroke="#f43f5e" strokeWidth="1.5" fill="#f43f5e" fillOpacity="0.15"/>
              <circle cx="16" cy="16" r="3" fill="#f43f5e"/>
              <circle cx="16" cy="16" r="1" fill="#fda4af"/>
              <path d="M16 6v-2M16 28v-2M6 16H4M28 16h-2" stroke="#fb7185" strokeWidth="1" opacity="0.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-bold text-sm tracking-tight">VisionLab</span>
          <span className="hidden sm:block text-white/20 text-xs font-light">
            Multimodal Vision AI
          </span>
        </div>

        <div className="ml-auto">
          <button
            onClick={() => fileInputRef.current?.click()}
            title={`Upload an image (${ACCEPTED_LABEL}, up to 4MB)`}
            aria-label="Upload an image"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/[0.08] border border-white/[0.08] text-xs text-gray-400 hover:text-white transition-all duration-200"
          >
            <Upload size={13} />
            <span>Upload</span>
          </button>
        </div>
      </header>

      {/* Description */}
      <div className="relative z-10 px-5 py-2 border-b border-white/[0.04] flex-shrink-0" style={{ background: 'rgba(244,63,94,0.02)' }}>
        <p className="text-xs text-gray-500 leading-relaxed max-w-3xl" style={{ margin: 0 }}>
          Upload a photo and pick what you want to know. It can describe the whole scene, break down objects and composition, pull out any visible text, or answer specific questions about what's in the image. Uses Claude's vision model, not a toy.
        </p>
      </div>

      {/* Main */}
      <main className="relative z-10 flex-1 flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          {!hasImage ? (
            <DropZone
              key="dropzone"
              modes={MODES}
              isDragging={isDragging}
              uploadError={uploadError}
              onPick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          ) : (
            <motion.div
              key="split"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col lg:flex-row min-h-0"
            >
              <ImageStage
                url={currentUrl}
                label={imageLabel}
                fileName={currentFile?.name ?? 'Gallery image'}
                isDragging={isDragging}
                uploadError={uploadError}
                onZoom={() => setIsZoomed(true)}
                onClear={clearImage}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />

              <AnalysisPanel
                modes={MODES}
                modeLabels={MODE_LABELS}
                mode={mode}
                onModeChange={handleModeChange}
                question={question}
                questionError={questionError}
                onQuestionChange={value => {
                  setQuestion(value)
                  if (questionError) setQuestionError('')
                }}
                isLoading={isLoading}
                canAnalyze={Boolean(currentFile)}
                analysisText={analysisText}
                isTruncated={isTruncated}
                errorText={errorText}
                noticeText={noticeText}
                scrollRef={analysisRef}
                onAnalyze={handleAnalyze}
                onCancel={handleCancel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {gallery.length > 0 && (
          <HistoryStrip
            items={gallery}
            activeId={activeGalleryId}
            modeLabels={MODE_LABELS}
            atCapacity={gallery.length >= HISTORY_LIMIT}
            onSelect={loadGalleryItem}
            onClear={clearGallery}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isZoomed && currentUrl && (
          <ZoomOverlay src={currentUrl} label={imageLabel} onClose={() => setIsZoomed(false)} />
        )}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={handleInputChange}
      />
      <footer className="relative z-10 text-center py-3 text-xs text-white/20 border-t border-white/[0.04]">
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
