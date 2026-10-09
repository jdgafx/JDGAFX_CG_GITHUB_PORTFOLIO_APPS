import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeImage, upsertStep } from './api'
import type { AnalysisMode, RunSummary, TraceStep } from './api'
import type { CommonsImage } from './commons'
import { createThumbnailUrl, fileProblem } from './image'
import { DEFAULT_BOX, regionTag, type Box, type PixelRect } from './region'

export type RunStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled'
export type Slot = 'a' | 'b'

export interface GalleryItem {
  id: string
  previewUrl: string
  file: File
  source: CommonsImage | null
  fileB: File | null
  sourceB: CommonsImage | null
  mode: AnalysisMode
  question: string
  result: string
  summary: RunSummary
}

// One question asked about one box. The list of these is the region history of the current picture.
export interface RegionEntry {
  id: string
  tag: string
  box: Box
  rect: PixelRect | null
  cropUrl: string
  question: string
  result: string
  status: RunStatus
  notice: string
  truncated: boolean
  summary: RunSummary | null
}

type GalleryDraft = Omit<GalleryItem, 'id' | 'previewUrl'>

const HISTORY_LIMIT = 12
const CANCELLED_NOTICE = 'Analysis cancelled. Anything above is only a partial answer.'
const QUESTION_REQUIRED = 'Type a question before you analyze the image.'
const BOX_REQUIRED = 'Draw a box on the picture first, then ask about it.'
const SECOND_REQUIRED = 'Choose a second image to compare.'
export const WHOLE_MODES: AnalysisMode[] = ['describe', 'analyze', 'qa', 'extract']

// Owns the state of one VisionLab page: the images, the controls, the run, the region list and the
// recent analyses. Nothing here is stored outside the page.
export function useAnalysis() {
  const [file, setFile] = useState<File | null>(null)
  // Set when the image came from Wikimedia Commons, so its credit stays beside it.
  const [source, setSource] = useState<CommonsImage | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [fileB, setFileB] = useState<File | null>(null)
  const [sourceB, setSourceB] = useState<CommonsImage | null>(null)
  const [imageUrlB, setImageUrlB] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('describe')
  const [lastWhole, setLastWhole] = useState<AnalysisMode>('describe')
  const [question, setQuestion] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [box, setBox] = useState<Box | null>(null)
  const [regions, setRegions] = useState<RegionEntry[]>([])
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
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
  const urlsRef = useRef<Record<Slot, string>>({ a: '', b: '' })
  const galleryRef = useRef<GalleryItem[]>([])
  const regionsRef = useRef<RegionEntry[]>([])
  const regionCount = useRef(0)
  const running = status === 'running'

  // Stop any run and release every object URL this page owns when it unmounts.
  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      abortRef.current?.abort()
      for (const url of Object.values(urls)) if (url) URL.revokeObjectURL(url)
      for (const item of galleryRef.current) URL.revokeObjectURL(item.previewUrl)
      for (const entry of regionsRef.current) if (entry.cropUrl) URL.revokeObjectURL(entry.cropUrl)
    }
  }, [])

  const updateRegions = useCallback((next: RegionEntry[]) => {
    regionsRef.current = next
    setRegions(next)
  }, [])

  const patchRegion = useCallback(
    (id: string, patch: Partial<RegionEntry>) => {
      updateRegions(regionsRef.current.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)))
    },
    [updateRegions],
  )

  const dropRegions = useCallback(() => {
    for (const entry of regionsRef.current) if (entry.cropUrl) URL.revokeObjectURL(entry.cropUrl)
    regionCount.current = 0
    updateRegions([])
    setActiveRegionId(null)
    setBox(null)
  }, [updateRegions])

  const showImage = useCallback((slot: Slot, next: File, credit: CommonsImage | null) => {
    if (urlsRef.current[slot]) URL.revokeObjectURL(urlsRef.current[slot])
    const url = URL.createObjectURL(next)
    urlsRef.current[slot] = url
    if (slot === 'a') {
      setImageUrl(url)
      setFile(next)
      setSource(credit)
    } else {
      setImageUrlB(url)
      setFileB(next)
      setSourceB(credit)
    }
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

  // An uploaded, dropped or pasted file has no credit; a Commons pick passes its own.
  const chooseFile = useCallback(
    (next: File, credit: CommonsImage | null = null, slot: Slot = 'a') => {
      if (running) return
      const problem = fileProblem(next)
      setUploadError(problem ?? '')
      if (problem) return
      showImage(slot, next, credit)
      if (slot === 'a') dropRegions()
      clearResult()
      setQuestionError('')
      setActiveId(null)
    },
    [running, showImage, clearResult, dropRegions],
  )

  const removeImage = useCallback(
    (slot: Slot = 'a') => {
      if (running) return
      if (urlsRef.current[slot]) URL.revokeObjectURL(urlsRef.current[slot])
      urlsRef.current[slot] = ''
      if (slot === 'a') {
        setImageUrl('')
        setFile(null)
        setSource(null)
        dropRegions()
      } else {
        setImageUrlB('')
        setFileB(null)
        setSourceB(null)
      }
      setUploadError('')
      setQuestionError('')
      setActiveId(null)
      clearResult()
    },
    [running, clearResult, dropRegions],
  )

  const displayRegion = useCallback(
    (entry: RegionEntry) => {
      clearResult()
      resultRef.current = entry.result
      setResult(entry.result)
      setSummary(entry.summary)
      setSteps(entry.summary?.trace ?? [])
      setStatus(entry.status === 'running' ? 'idle' : entry.status)
      setTruncated(entry.truncated)
      setNotice(entry.notice)
      setQuestion(entry.question)
      setActiveRegionId(entry.id)
    },
    [clearResult],
  )

  const changeMode = useCallback(
    (next: AnalysisMode) => {
      if (running || next === mode) return
      setMode(next)
      if (WHOLE_MODES.includes(next)) setLastWhole(next)
      setQuestionError('')
      setActiveId(null)
      // The previous answer belongs to the previous mode.
      clearResult()
      const last = regionsRef.current.at(-1)
      if (next === 'region') {
        if (last) displayRegion(last)
      } else {
        setActiveRegionId(null)
      }
    },
    [running, mode, clearResult, displayRegion],
  )

  const updateQuestion = useCallback((value: string) => {
    setQuestion(value)
    setQuestionError('')
  }, [])

  const drawBox = useCallback((next: Box | null) => {
    setBox(next)
    setQuestionError('')
  }, [])

  const selectRegion = useCallback(
    (id: string) => {
      if (running) return
      const entry = regionsRef.current.find(item => item.id === id)
      if (entry) displayRegion(entry)
    },
    [running, displayRegion],
  )

  const addToGallery = useCallback(async (draft: GalleryDraft) => {
    const previewUrl = (await createThumbnailUrl(draft.file)) ?? URL.createObjectURL(draft.file)
    const item: GalleryItem = {
      ...draft,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    const needsQuestion = mode === 'qa' || mode === 'region'
    if (needsQuestion && !asked) {
      setQuestionError(QUESTION_REQUIRED)
      return
    }
    if (mode === 'region' && !box) {
      setQuestionError(BOX_REQUIRED)
      return
    }
    if (mode === 'compare' && !fileB) {
      setUploadError(SECOND_REQUIRED)
      return
    }
    setQuestionError('')
    setUploadError('')
    clearResult()
    setStatus('running')

    let entryId: string | null = null
    if (mode === 'region' && box) {
      regionCount.current += 1
      entryId = `r${regionCount.current}-${Date.now()}`
      updateRegions([
        ...regionsRef.current,
        {
          id: entryId,
          tag: regionTag(regionCount.current),
          box,
          rect: null,
          cropUrl: '',
          question: asked,
          result: '',
          status: 'running',
          notice: '',
          truncated: false,
          summary: null,
        },
      ])
      setActiveRegionId(entryId)
    }

    const controller = new AbortController()
    abortRef.current = controller
    const outcome = await analyzeImage({
      file,
      mode,
      question: asked || undefined,
      box: mode === 'region' ? (box ?? undefined) : undefined,
      fileB: mode === 'compare' ? (fileB ?? undefined) : undefined,
      signal: controller.signal,
      onCrop: crop => {
        if (entryId) patchRegion(entryId, { rect: crop.rect, cropUrl: URL.createObjectURL(crop.file) })
      },
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
      if (entryId) {
        patchRegion(entryId, { result: outcome.result, status: 'complete', summary: outcome.summary })
        setBox(null)
        return
      }
      // A history thumbnail that cannot be made must not change the answer shown above.
      addToGallery({
        file,
        source,
        fileB: mode === 'compare' ? fileB : null,
        sourceB: mode === 'compare' ? sourceB : null,
        mode,
        question: needsQuestion || mode === 'compare' ? asked : '',
        result: outcome.result,
        summary: outcome.summary,
      }).catch(() => undefined)
      return
    }
    // Partial output stays visible; the notice explains why it stopped.
    setResult(resultRef.current)
    const cancelled = outcome.status === 'cancelled'
    const message = cancelled ? CANCELLED_NOTICE : outcome.message
    const cut = outcome.status === 'failed' && outcome.truncated
    setStatus(cancelled ? 'cancelled' : 'failed')
    setNotice(message)
    setTruncated(cut)
    if (entryId) {
      patchRegion(entryId, {
        result: resultRef.current,
        status: cancelled ? 'cancelled' : 'failed',
        notice: message,
        truncated: cut,
        summary: outcome.summary,
      })
    }
  }, [file, fileB, source, sourceB, box, mode, question, running, addToGallery, clearResult, patchRegion, updateRegions])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reopen = useCallback(
    (item: GalleryItem) => {
      if (running) return
      dropRegions()
      showImage('a', item.file, item.source)
      if (item.fileB) showImage('b', item.fileB, item.sourceB)
      setMode(item.mode)
      if (WHOLE_MODES.includes(item.mode)) setLastWhole(item.mode)
      setQuestion(item.question)
      setQuestionError('')
      setUploadError('')
      clearResult()
      resultRef.current = item.result
      setResult(item.result)
      setSteps(item.summary.trace)
      setSummary(item.summary)
      setStatus('complete')
      setActiveId(item.id)
    },
    [running, showImage, clearResult, dropRegions],
  )

  // Starting a region from the keyboard: Enter on the picture with no box yet puts a starter box in the middle.
  const startBox = useCallback(() => setBox(current => current ?? DEFAULT_BOX), [])

  return {
    file,
    source,
    imageUrl,
    fileB,
    sourceB,
    imageUrlB,
    mode,
    lastWhole,
    question,
    questionError,
    uploadError,
    box,
    regions,
    activeRegionId,
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
    drawBox,
    startBox,
    selectRegion,
    run,
    cancel,
    reopen,
    clearGallery,
  }
}
