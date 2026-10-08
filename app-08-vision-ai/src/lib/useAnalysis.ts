import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeImage, fileProblem } from './api'
import type { AnalysisMode, RunSummary, TraceStep } from './api'
import { createThumbnailUrl } from './image'

export type RunStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled'

export interface GalleryItem {
  id: string
  previewUrl: string
  file: File
  name: string
  mode: AnalysisMode
  question: string
  result: string
  truncated: boolean
  summary: RunSummary
}

type GalleryDraft = Omit<GalleryItem, 'id' | 'previewUrl' | 'name'>

const HISTORY_LIMIT = 12
const CANCELLED_NOTICE = 'Run cancelled. Anything above is only a partial result.'
const QUESTION_REQUIRED = 'Type a question before you run this analysis.'

function upsertStep(steps: TraceStep[], step: TraceStep): TraceStep[] {
  const index = steps.findIndex(existing => existing.name === step.name)
  if (index === -1) return [...steps, step]
  const next = steps.slice()
  next[index] = step
  return next
}

// Owns the state of one VisionLab page: the image, the controls, the run, and the
// recent analyses. Nothing here is stored outside the page.
export function useAnalysis() {
  const [file, setFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('describe')
  const [question, setQuestion] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [result, setResult] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [notice, setNotice] = useState('')
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const resultRef = useRef('')
  const imageUrlRef = useRef('')
  const galleryRef = useRef<GalleryItem[]>([])
  const running = status === 'running'

  // Stop any run and release every object URL this page owns when it unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      for (const item of galleryRef.current) URL.revokeObjectURL(item.previewUrl)
    }
  }, [])

  const showImage = useCallback((next: File) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    const url = URL.createObjectURL(next)
    imageUrlRef.current = url
    setImageUrl(url)
    setFile(next)
  }, [])

  const clearResult = useCallback(() => {
    resultRef.current = ''
    setResult('')
    setTruncated(false)
    setNotice('')
    setSteps([])
    setSummary(null)
    setStatus('idle')
  }, [])

  const chooseFile = useCallback(
    (next: File) => {
      if (running) return
      const problem = fileProblem(next)
      setUploadError(problem ?? '')
      if (problem) return
      showImage(next)
      clearResult()
      setQuestionError('')
      setActiveId(null)
    },
    [running, showImage, clearResult],
  )

  const removeImage = useCallback(() => {
    if (running) return
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    imageUrlRef.current = ''
    setImageUrl('')
    setFile(null)
    setUploadError('')
    setQuestionError('')
    setActiveId(null)
    clearResult()
  }, [running, clearResult])

  const changeMode = useCallback(
    (next: AnalysisMode) => {
      if (running || next === mode) return
      setMode(next)
      setQuestionError('')
      setActiveId(null)
      // The previous answer belongs to the previous mode.
      clearResult()
    },
    [running, mode, clearResult],
  )

  const updateQuestion = useCallback((value: string) => {
    setQuestion(value)
    setQuestionError('')
  }, [])

  const addToGallery = useCallback(async (draft: GalleryDraft) => {
    const previewUrl = (await createThumbnailUrl(draft.file)) ?? URL.createObjectURL(draft.file)
    const item: GalleryItem = {
      ...draft,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: draft.file.name,
      previewUrl,
    }
    const previous = galleryRef.current
    const next = [item, ...previous].slice(0, HISTORY_LIMIT)
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
    setActiveId(null)
  }, [])

  const run = useCallback(async () => {
    if (!file || running) return
    const asked = question.trim()
    if (mode === 'qa' && !asked) {
      setQuestionError(QUESTION_REQUIRED)
      return
    }
    setQuestionError('')
    setUploadError('')
    resultRef.current = ''
    setResult('')
    setTruncated(false)
    setNotice('')
    setSteps([])
    setSummary(null)
    setStatus('running')

    const controller = new AbortController()
    abortRef.current = controller
    const outcome = await analyzeImage({
      file,
      mode,
      question: mode === 'qa' ? asked : undefined,
      signal: controller.signal,
      onStep: step => setSteps(current => upsertStep(current, step)),
      onText: text => {
        resultRef.current += text
        setResult(resultRef.current)
      },
    })
    abortRef.current = null
    setSteps(outcome.summary.trace)
    setSummary(outcome.summary)

    if (outcome.status === 'complete') {
      resultRef.current = outcome.result
      setResult(outcome.result)
      setStatus('complete')
      void addToGallery({
        file,
        mode,
        question: mode === 'qa' ? asked : '',
        result: outcome.result,
        truncated: false,
        summary: outcome.summary,
      })
      return
    }
    // Partial output stays visible; the notice explains why it stopped.
    setResult(resultRef.current)
    if (outcome.status === 'cancelled') {
      setStatus('cancelled')
      setNotice(CANCELLED_NOTICE)
      return
    }
    setStatus('failed')
    setTruncated(outcome.truncated)
    setNotice(outcome.message)
  }, [file, mode, question, running, addToGallery])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reopen = useCallback(
    (item: GalleryItem) => {
      if (running) return
      showImage(item.file)
      setMode(item.mode)
      setQuestion(item.question)
      setQuestionError('')
      setUploadError('')
      resultRef.current = item.result
      setResult(item.result)
      setTruncated(item.truncated)
      setNotice('')
      setSteps(item.summary.trace)
      setSummary(item.summary)
      setStatus('complete')
      setActiveId(item.id)
    },
    [running, showImage],
  )

  return {
    file,
    imageUrl,
    mode,
    question,
    questionError,
    uploadError,
    status,
    steps,
    summary,
    result,
    truncated,
    notice,
    gallery,
    activeId,
    chooseFile,
    removeImage,
    changeMode,
    updateQuestion,
    run,
    cancel,
    reopen,
    clearGallery,
  }
}
