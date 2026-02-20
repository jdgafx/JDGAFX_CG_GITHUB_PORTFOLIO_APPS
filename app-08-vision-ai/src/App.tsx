import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera,
  Upload,
  ZoomIn,
  ZoomOut,
  X,
  Loader2,
  Eye,
  BarChart2,
  MessageSquare,
  FileText,
  Send,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { analyzeImage } from './lib/api'
import type { AnalysisMode } from './lib/api'

interface GalleryItem {
  id: string
  url: string
  name: string
  mode: AnalysisMode
  result: string
}

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

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="block w-1 h-1 rounded-full bg-rose-400"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </span>
  )
}

export default function App() {
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [currentUrl, setCurrentUrl] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('describe')
  const [question, setQuestion] = useState('')
  const [analysisText, setAnalysisText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const analysisRef = useRef<HTMLDivElement>(null)
  const accTextRef = useRef('')
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    const el = analysisRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [analysisText])

  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.push(url)
    setCurrentUrl(url)
    setCurrentFile(file)
    setAnalysisText('')
    setActiveGalleryId(null)
    accTextRef.current = ''
  }, [])

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
    },
    [loadFile],
  )

  const clearImage = useCallback(() => {
    setCurrentUrl('')
    setCurrentFile(null)
    setAnalysisText('')
    setActiveGalleryId(null)
    accTextRef.current = ''
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!currentFile || isLoading) return
    setIsLoading(true)
    setAnalysisText('')
    accTextRef.current = ''

    await analyzeImage({
      file: currentFile,
      mode,
      question: mode === 'qa' ? question : undefined,
      onChunk: text => {
        accTextRef.current += text
        setAnalysisText(accTextRef.current)
      },
      onComplete: () => {
        setIsLoading(false)
        const result = accTextRef.current
        setGallery((prev: GalleryItem[]) => [
          {
            id: Date.now().toString(),
            url: currentUrl,
            name: currentFile.name,
            mode,
            result,
          },
          ...prev.slice(0, 11),
        ])
      },
      onError: err => {
        setIsLoading(false)
        setAnalysisText(`⚠️ ${err.message}`)
      },
    })
  }, [currentFile, isLoading, mode, question, currentUrl])

  const loadGalleryItem = useCallback((item: GalleryItem) => {
    setCurrentUrl(item.url)
    setCurrentFile(null)
    setMode(item.mode)
    setAnalysisText(item.result)
    setActiveGalleryId(item.id)
    accTextRef.current = item.result
  }, [])

  const hasImage = Boolean(currentUrl)

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
            <Eye size={13} className="text-rose-400" />
          </div>
          <span className="font-bold text-sm tracking-tight">VisionLab</span>
          <span className="hidden sm:block text-white/20 text-xs font-light">
            Multimodal Vision AI
          </span>
        </div>

        <div className="ml-auto">
          <button
            onClick={() => fileInputRef.current?.click()}
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
          Upload any image (JPG, PNG, WebP, GIF) and choose an analysis mode. Describe generates a detailed natural-language description of the scene. Analyze identifies objects, composition, colors, and visual patterns. Extract pulls out any text, labels, or numbers visible in the image. Q&amp;A lets you ask specific questions about the image content. Powered by Claude Sonnet 4.6 with streaming responses.
        </p>
      </div>

      {/* Main */}
      <main className="relative z-10 flex-1 flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          {!hasImage ? (
            /* ── Drop Zone ── */
            <motion.div
              key="dropzone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center p-6"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-full max-w-lg"
              >
                <button
                  onClick={() => fileInputRef.current?.click()}
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
                      isDragging
                        ? 'bg-rose-500/15 ring-1 ring-rose-500/30'
                        : 'bg-white/[0.04]'
                    }`}
                  >
                    <Camera
                      size={26}
                      className={isDragging ? 'text-rose-400' : 'text-gray-600'}
                    />
                  </motion.div>

                  <div className="text-center">
                    <p className="text-base font-medium text-gray-200">
                      Drop image or click to upload
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      JPG, PNG, WebP, GIF supported
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-1.5">
                    {MODES.map(({ id, label, icon: Icon }) => (
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

                <p className="text-center text-gray-700 text-xs mt-4">
                  Powered by Claude Vision · Describe, analyze, extract, and query images with AI
                </p>
              </motion.div>
            </motion.div>
          ) : (
            /* ── Split Layout ── */
            <motion.div
              key="split"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col lg:flex-row min-h-0"
            >
              {/* Left: Image Display */}
              <div
                className="lg:flex-1 flex flex-col items-center justify-center p-5 min-h-[40vh] lg:min-h-0 relative"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragging && (
                  <div className="absolute inset-4 rounded-xl border-2 border-dashed border-rose-500/50 bg-rose-500/[0.04] flex items-center justify-center pointer-events-none z-10">
                    <p className="text-rose-400 text-sm font-medium">
                      Drop to replace image
                    </p>
                  </div>
                )}

                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className="relative group max-w-full"
                >
                  <div
                    className="relative rounded-xl overflow-hidden cursor-zoom-in"
                    style={{
                      boxShadow:
                        '0 0 0 1px rgba(244,63,94,0.12), 0 0 60px rgba(244,63,94,0.08), 0 20px 60px rgba(0,0,0,0.5)',
                    }}
                    onClick={() => setIsZoomed(true)}
                  >
                    <img
                      src={currentUrl}
                      alt="Analysis target"
                      className="max-w-full object-contain block"
                      style={{ maxHeight: 'calc(100vh - 18rem)' }}
                    />

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Toolbar */}
                    <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <button
                        className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center text-gray-300 hover:text-white transition-colors"
                        onClick={e => {
                          e.stopPropagation()
                          setIsZoomed(true)
                        }}
                      >
                        <ZoomIn size={13} />
                      </button>
                      <button
                        className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center text-gray-300 hover:text-rose-400 transition-colors"
                        onClick={e => {
                          e.stopPropagation()
                          clearImage()
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  <p className="text-gray-700 text-xs mt-2 text-center truncate max-w-xs">
                    {currentFile?.name ?? 'Gallery image'}
                  </p>
                </motion.div>
              </div>

              {/* Right: Analysis Panel */}
              <div className="lg:w-[44%] xl:w-[42%] flex flex-col border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-black/20 min-h-0">
                {/* Mode selector */}
                <div className="p-3 border-b border-white/[0.06] flex flex-wrap gap-1.5 flex-shrink-0">
                  {MODES.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setMode(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                        mode === id
                          ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                          : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08] hover:text-gray-300 border border-white/[0.08]'
                      }`}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Q&A input */}
                <AnimatePresence>
                  {mode === 'qa' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden flex-shrink-0"
                    >
                      <div className="p-3 border-b border-white/[0.06]">
                        <input
                          type="text"
                          value={question}
                          onChange={e => setQuestion(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleAnalyze()
                          }}
                          placeholder="Ask a question about this image…"
                          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-rose-500/40 focus:bg-rose-500/[0.03] transition-all duration-200"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Analyze button */}
                <div className="p-3 border-b border-white/[0.06] flex-shrink-0">
                  <button
                    onClick={() => void handleAnalyze()}
                    disabled={isLoading || !currentFile}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-all duration-200 shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:shadow-[0_0_28px_rgba(244,63,94,0.4)]"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Analyzing</span>
                        <LoadingDots />
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>Analyze Image</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Analysis results */}
                <div
                  ref={analysisRef}
                  className="flex-1 overflow-y-auto p-4 min-h-0"
                >
                  {isLoading && !analysisText ? (
                    /* Skeleton */
                    <div className="space-y-2.5 pt-1">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div
                          key={i}
                          className="h-2.5 rounded-full bg-white/[0.05] animate-pulse"
                          style={{ width: `${92 - i * 8}%` }}
                        />
                      ))}
                    </div>
                  ) : analysisText ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm text-gray-300 leading-[1.8] whitespace-pre-wrap"
                      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}
                    >
                      {analysisText}
                      {isLoading && (
                        <span className="inline-block w-0.5 h-3.5 bg-rose-500 ml-0.5 animate-pulse align-middle" />
                      )}
                    </motion.div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                      <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center">
                        {(() => {
                          const found = MODES.find(m => m.id === mode)
                          if (!found) return null
                          const Icon = found.icon
                          return <Icon size={18} className="text-gray-700" />
                        })()}
                      </div>
                      <div>
                        <p className="text-gray-600 text-sm">
                          Ready to {MODE_LABELS[mode].toLowerCase()}
                        </p>
                        <p className="text-gray-800 text-xs mt-0.5">
                          Press Analyze Image to start
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Gallery strip */}
      <AnimatePresence>
        {gallery.length > 0 && (
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
              {gallery.map(item => (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => loadGalleryItem(item)}
                  className={`flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden transition-all duration-200 ${
                    activeGalleryId === item.id
                      ? 'ring-2 ring-rose-500 ring-offset-1 ring-offset-[#080810]'
                      : 'ring-1 ring-white/[0.08] hover:ring-rose-500/40'
                  }`}
                  title={`${item.name} · ${MODE_LABELS[item.mode]}`}
                >
                  <img
                    src={item.url}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Zoom overlay */}
      <AnimatePresence>
        {isZoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/92 backdrop-blur-2xl flex items-center justify-center p-8"
            onClick={() => setIsZoomed(false)}
          >
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                className="w-9 h-9 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] flex items-center justify-center text-gray-300 hover:text-white transition-colors"
                onClick={() => setIsZoomed(false)}
              >
                <ZoomOut size={16} />
              </button>
              <button
                className="w-9 h-9 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] flex items-center justify-center text-gray-300 hover:text-white transition-colors"
                onClick={() => setIsZoomed(false)}
              >
                <X size={16} />
              </button>
            </div>

            <motion.img
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              src={currentUrl}
              alt="Zoomed view"
              className="max-w-full max-h-full object-contain rounded-xl"
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleInputChange}
      />
      <footer className="relative z-10 text-center py-3 text-xs text-white/20 border-t border-white/[0.04]">
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
