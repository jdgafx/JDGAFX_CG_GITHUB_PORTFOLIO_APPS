import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { accountFiles, buildDiff, type PrFileInput } from '../netlify/shared/diff'
import { CodeEditor } from './components/CodeEditor'
import { FileSource } from './components/FileSource'
import { Header, statusBadge } from './components/Header'
import { HowTo } from './components/HowTo'
import { ModeTabs, type Mode } from './components/ModeTabs'
import { PrFiles } from './components/PrFiles'
import { PrSource } from './components/PrSource'
import { ReadoutStrip } from './components/ReadoutStrip'
import { ReplayLabel } from './components/ReplayLabel'
import { ResultCard } from './components/ResultCard'
import { RunTrace } from './components/RunTrace'
import { SEVERITY_ORDER, getFileExt } from './constants'
import { ReviewError, reviewCode, reviewErrorMessage, reviewPullRequest, type OnFirstPass } from './lib/api'
import { emptyBodyFor, reviewAsText, statusLineFor } from './lib/screentext'
import { liveData } from './lib/livedata'
import type { GitHubFile } from './lib/github'
import { MAX_CODE_LENGTH } from './lib/limits'
import { diffContext, fileContext, type ContextLine } from './lib/context'
import { initialSelection, lineHref, type PullRequest } from './lib/pullrequest'
import { EXAMPLE_LINK, loadExample } from './lib/tryit'
import { useEditorJump } from './lib/useEditorJump'
import { useReplay } from './lib/useReplay'
import { useResultFocus, type Recording } from './replay'
import { countVerdicts, isShown } from './lib/verdicts'
import type { ReviewComment, ReviewResult, RunPhase, RunSummary, Severity } from './types'

const ALL_SEVERITIES_ON: Record<Severity, boolean> = { critical: true, warning: true, info: true }

const bySeverityThenLine = (a: ReviewComment, b: ReviewComment): number => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line

const sortComments = (comments: ReviewComment[]) => [...comments].sort(bySeverityThenLine)

export default function App() {
  const [mode, setMode] = useState<Mode>('file')
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [result, setResult] = useState<ReviewResult | null>(null)
  /** True from the moment the first pass's comments are on the page until the reads have settled them: nothing in `result` is confirmed yet. */
  const [checking, setChecking] = useState(false)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null)
  const [filters, setFilters] = useState<Record<Severity, boolean>>(ALL_SEVERITIES_ON)
  const [copied, setCopied] = useState(false)
  /** The GitHub file the editor was filled from. Its text is the editor text until the visitor edits it. */
  const [source, setSource] = useState<GitHubFile | null>(null)
  const [pr, setPr] = useState<PullRequest | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  /** What the shown result was reviewed from, to tell when the input has changed since. */
  const [reviewedInput, setReviewedInput] = useState<string | null>(null)
  /** The exact text or files the shown result was reviewed from: a comment's context is read from here, never from the editor. */
  const [reviewedCode, setReviewedCode] = useState<string | null>(null)
  const [reviewedFiles, setReviewedFiles] = useState<PrFileInput[] | null>(null)
  /** The comment the reader jumped to the editor from, and where the page was, so Back returns to the same place. */
  const [jump, setJump] = useState<ReviewComment | null>(null)
  const jumpScroll = useRef(0)
  /** When the file or pull request now loaded was fetched, and whether the last fetch failed: the live-data indicator. */
  const [fileFetchedAt, setFileFetchedAt] = useState<Date | null>(null)
  const [prFetchedAt, setPrFetchedAt] = useState<Date | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [collapseKey, setCollapseKey] = useState(0)
  /** Try it: fetching the example file, and why that failed. */
  const [tryBusy, setTryBusy] = useState(false)
  const [tryError, setTryError] = useState<string | null>(null)
  const [fill, setFill] = useState<{ link: string } | null>(null)
  /** The review on screen is a recording played back through the app's own client, not a live run. */
  const [replayed, setReplayed] = useState(false)
  const tryAbortRef = useRef<AbortController | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const running = phase === 'running'
  const replay = useReplay({
    idle: phase === 'idle' && code === '' && result === null && !tryBusy,
    onStart: (recording) => void handleTryIt(recording),
    onDiverge: () => handleDiverge(),
  })
  const account = useMemo(() => (pr ? accountFiles(pr.files, selected) : null), [pr, selected])
  const lineCount = code.split('\n').length
  const isOverLimit = code.length > MAX_CODE_LENGTH
  const canReview =
    !running &&
    (mode === 'file' ? code.trim().length > 0 && !isOverLimit : account !== null && account.filesIncluded > 0 && account.changedIncluded > 0)

  const inputKey = mode === 'file' ? `file:${code}` : `pr:${pr?.number ?? 0}:${[...selected].sort().join('|')}`
  const stale = result !== null && reviewedInput !== null && inputKey !== reviewedInput
  const counts = result ? countVerdicts(result.comments) : null
  const live = liveData({
    mode,
    fetchedAt: mode === 'file' ? (source ? fileFetchedAt : null) : pr ? prFetchedAt : null,
    failed: fetchFailed,
    ownCode: mode === 'file' && code.trim() !== '' && (source === null || code !== source.text),
  })
  const badge = statusBadge(phase, (result?.verified ?? false) && (result?.notReviewed ?? []).length === 0, counts)
  const reviewedLines = useMemo(() => (reviewedCode === null ? null : reviewedCode.split('\n')), [reviewedCode])
  const reviewedUnits = useMemo(() => (reviewedFiles === null ? null : buildDiff(reviewedFiles).units), [reviewedFiles])
  // What the reader acts on: kept and moved comments, and, when a second-pass read failed, the comments left unconfirmed.
  const shownComments = useMemo(() => (result ? result.comments.filter((c) => isShown(c) && (result.verified ? c.verdict !== 'unverified' : true)) : []), [result])
  /** Commented lines of the reviewed file, the most severe comment on each. Not offered once the editor text has changed. */
  const marks = useMemo(() => {
    const map = new Map<number, ReviewComment>()
    if (result?.mode !== 'file' || stale || checking) return map
    for (const c of [...shownComments].sort(bySeverityThenLine).reverse()) map.set(c.line, c)
    return map
  }, [result, shownComments, stale, checking])
  const commentCounts = useMemo(() => {
    const out: Record<string, number> = {}
    if (result?.mode !== 'pr' || checking) return out
    for (const c of shownComments) if (c.where) out[c.where.file] = (out[c.where.file] ?? 0) + 1
    return out
  }, [result, shownComments, checking])

  const contextOf = useCallback(
    (c: ReviewComment): ContextLine[] | null => {
      if (result?.mode === 'file') return reviewedLines ? fileContext(reviewedLines, c.line) : null
      return reviewedUnits ? diffContext(reviewedUnits, c.line) : null
    },
    [result, reviewedLines, reviewedUnits],
  )
  const hrefOf = (c: ReviewComment): string | null => (result?.mode === 'pr' && pr && c.where ? lineHref(pr, c.where) : null)

  // On a phone the result sits below the controls: the hook scrolls it into view and focuses its heading when a run ends.
  useResultFocus(phase, { onRunStart: (narrow) => narrow && setCollapseKey((n) => n + 1), replay: replayed })

  // Drop the in-flight review and the pending copy reset when the component goes away.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      tryAbortRef.current?.abort()
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  // Focus follows the action: Stop takes focus when a run starts, without moving the page.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  useEditorJump({ textareaRef, lineNumbersRef, highlightedLine, jump, code })

  const handleReview = useCallback(async (example?: { code: string; language: string }, options: { replay?: boolean } = {}) => {
    if (!example && !canReview) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('running')
    setReplayed(options.replay === true)
    setResult(null)
    setChecking(false)
    setSummary(null)
    setError(null)
    setHighlightedLine(null)
    setFilters(ALL_SEVERITIES_ON)
    setCopied(false)
    setReviewedInput(null)
    setJump(null)
    const asFile = example !== undefined || mode === 'file'
    const text = example?.code ?? code
    const files = asFile ? [] : (pr?.files ?? []).filter((f) => selected.has(f.path))
    const show = (run: Parameters<OnFirstPass>[0]) => {
      const { result: next, ...runSummary } = run
      setResult(next)
      setSummary(runSummary)
      setReviewedInput(asFile ? `file:${text}` : inputKey)
      setReviewedCode(asFile ? text : null)
      setReviewedFiles(asFile ? null : files)
    }
    // The first pass's comments go up as soon as they are back; a stopped or replaced run shows nothing of them.
    const onFirstPass: OnFirstPass = (run) => {
      if (controller.signal.aborted) return
      show(run)
      setChecking(true)
    }
    try {
      const run = asFile ? await reviewCode(text, example?.language ?? language, controller.signal, onFirstPass) : await reviewPullRequest(files, controller.signal, onFirstPass)
      if (controller.signal.aborted) return
      show(run)
      setChecking(false)
      setPhase('done')
    } catch (err) {
      if (controller.signal.aborted) return
      setResult(null)
      setChecking(false)
      setError(reviewErrorMessage(err))
      if (err instanceof ReviewError) setSummary(err.summary)
      else console.error('CodeLens: unexpected review error', err)
      setPhase('failed')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [canReview, code, inputKey, language, mode, pr, selected])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleReview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleReview])

  /** Try it: fetch the example from GitHub, put it in the editor, review it as Review code does. With a recording: played back, only if it is of this file, and silent on failure. */
  const handleTryIt = async (recording?: Recording, runLive = false) => {
    if (!runLive && (running || tryBusy)) return
    tryAbortRef.current?.abort()
    const controller = new AbortController()
    tryAbortRef.current = controller
    setTryBusy(true)
    setTryError(null)
    setMode('file')
    try {
      const loaded = await loadExample(controller.signal).catch(() => null)
      if (loaded === null || controller.signal.aborted) return
      if (!loaded.ok) {
        if (recording) return
        setFetchFailed(true)
        setTryError(loaded.error)
        return
      }
      if (recording && !replay.begin(loaded.value.file.text, loaded.value.language)) return
      handleFileLoaded(loaded.value.file, loaded.value.language)
      setFill({ link: EXAMPLE_LINK })
      await handleReview({ code: loaded.value.file.text, language: loaded.value.language }, { replay: recording !== undefined })
    } finally {
      if (tryAbortRef.current === controller) {
        tryAbortRef.current = null
        setTryBusy(false)
      }
    }
  }

  /** Run it live: the recording is put away and the same example is reviewed with real requests. */
  const handleRunLive = () => {
    replay.stop()
    abortRef.current?.abort()
    void handleTryIt(undefined, true)
  }

  /** The recording could not answer a call: nothing of it stays; the page goes back to the empty state. */
  const handleDiverge = () => {
    abortRef.current?.abort()
    tryAbortRef.current?.abort()
    abortRef.current = tryAbortRef.current = null
    setTryBusy(false)
    setCode('')
    setSource(null)
    setFill(null)
    clearResults()
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    replay.stop()
    setReplayed(false)
    setPhase('stopped')
    setError(null)
    // A stopped run keeps nothing: the first pass's unconfirmed comments go with it.
    setResult(null)
    setSummary(null)
    setChecking(false)
  }

  const clearResults = () => {
    setPhase('idle')
    setReplayed(false)
    setResult(null)
    setChecking(false)
    setSummary(null)
    setError(null)
    setHighlightedLine(null)
    setReviewedInput(null)
    setReviewedCode(null)
    setReviewedFiles(null)
    setJump(null)
  }

  const handleFileLoaded = (file: GitHubFile, detected: string | null) => {
    if (detected) setLanguage(detected)
    setCode(file.text)
    setSource(file)
    setFileFetchedAt(new Date())
    setFetchFailed(false)
    clearResults()
    textareaRef.current?.scrollTo(0, 0)
    lineNumbersRef.current?.scrollTo(0, 0)
  }

  const handlePrLoaded = (loaded: PullRequest) => {
    setPr(loaded)
    setPrFetchedAt(new Date())
    setFetchFailed(false)
    setSelected(initialSelection(loaded))
    clearResults()
  }

  const handleClear = () => {
    setCode('')
    setSource(null)
    clearResults()
    textareaRef.current?.focus()
  }

  const handleToggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
    if (phase === 'done') setHighlightedLine(null)
  }

  const handleShowLine = (comment: ReviewComment) => {
    if (jump?.id === comment.id) {
      setJump(null)
      setHighlightedLine(null)
      return
    }
    jumpScroll.current = window.scrollY
    setHighlightedLine(comment.line)
    setJump(comment)
  }

  /** Back to the comment: the page returns to where it was, and focus lands on the button that made the jump. */
  const handleBack = () => {
    const id = jump?.id
    setJump(null)
    setHighlightedLine(null)
    window.scrollTo({ top: jumpScroll.current, behavior: 'auto' })
    if (id !== undefined) document.getElementById(`show-${id}`)?.focus({ preventScroll: true })
  }

  /** A marked number in the gutter: bring its comment into view and put focus on it. */
  const handleMarkClick = (comment: ReviewComment) => {
    const bring = () => {
      const card = document.getElementById(`finding-${comment.id}`)
      card?.scrollIntoView({ block: 'center' })
      card?.focus({ preventScroll: true })
    }
    if (filters[comment.severity]) bring()
    else {
      setFilters((prev) => ({ ...prev, [comment.severity]: true }))
      requestAnimationFrame(bring)
    }
  }

  const handleCopy = async () => {
    if (!result || checking) return
    const where = result.mode === 'pr' ? `pull request ${pr?.owner}/${pr?.repo}#${pr?.number}` : `${language}, ${result.lineCount} lines`
    const text = reviewAsText(result, where, sortComments(shownComments))
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const dock = (
    <div className="ds-actions">
      <button type="button" className="ds-button ds-button--primary" onClick={() => void handleReview()} disabled={!canReview} aria-busy={running}>
        {running ? 'Reviewing…' : mode === 'file' ? 'Review code' : 'Review pull request'}
      </button>
      {running && (
        <button type="button" className="ds-button" ref={stopRef} onClick={handleCancel}>
          Stop
        </button>
      )}
    </div>
  )

  const statusLine = statusLineFor(running, mode === 'file', lineCount, code.length, account?.filesIncluded ?? null, account?.filesTotal ?? 0)
  const emptyBody = emptyBodyFor(mode === 'file', account?.filesIncluded ?? null)

  return (
    <div className="ds-app" data-run={phase}>
      <Header badge={badge} live={live} />

      <main className="ds-main">
        <HowTo busy={running || tryBusy} error={tryError} collapseKey={collapseKey} onTry={() => void handleTryIt()} />
        <div className="ds-bench">
          <div className="ds-controls">
            <ModeTabs
              mode={mode}
              disabled={running}
              onChange={(next) => {
                setMode(next)
                setFetchFailed(false)
                clearResults()
              }}
            />
            <div id="source-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} className="ds-stack">
              {mode === 'file' ? (
                <FileSource
                  language={language}
                  code={code}
                  source={source}
                  edited={source !== null && code !== source.text}
                  disabled={running}
                  collapseKey={collapseKey}
                  fill={fill}
                  onFailure={() => setFetchFailed(true)}
                  onLanguageChange={setLanguage}
                  onLoaded={handleFileLoaded}
                >
                  {dock}
                </FileSource>
              ) : (
                <PrSource pr={pr} disabled={running} collapseKey={collapseKey} onFailure={() => setFetchFailed(true)} onLoaded={handlePrLoaded}>
                  {dock}
                </PrSource>
              )}
            </div>
            <p className="ds-help" role="status">
              {statusLine}
            </p>
          </div>

          <div className="ds-run">
            {replayed && replay.recording && <ReplayLabel recording={replay.recording} loadedAt={replay.loadedAt} onRunLive={handleRunLive} />}
            <div className="ds-run__result">
              <ResultCard
                phase={phase}
                error={error}
                result={result}
                checking={checking}
                hasSteps={(summary?.trace.length ?? 0) > 0}
                filters={filters}
                highlightedLine={highlightedLine}
                copied={copied}
                stale={stale}
                sortComments={sortComments}
                onToggleFilter={(severity) => setFilters((prev) => ({ ...prev, [severity]: !prev[severity] }))}
                onShowLine={handleShowLine}
                contextOf={contextOf}
                hrefOf={hrefOf}
                emptyBody={emptyBody}
                onRetry={() => void handleReview()}
                onCopy={() => void handleCopy()}
              />
            </div>
            <ReadoutStrip phase={phase} summary={summary} />
            <div className="ds-run__stage">
              {mode === 'file' ? (
                <CodeEditor
                  code={code}
                  fileLabel={source ? source.path.slice(source.path.lastIndexOf('/') + 1) : `code.${getFileExt(language)}`}
                  lineCount={lineCount}
                  highlightedLine={highlightedLine}
                  running={running}
                  canReview={canReview}
                  textareaRef={textareaRef}
                  lineNumbersRef={lineNumbersRef}
                  jump={jump}
                  marks={marks}
                  onMarkClick={handleMarkClick}
                  onBack={handleBack}
                  onChange={(value) => {
                    setCode(value)
                    setHighlightedLine(null)
                  }}
                  onReview={() => void handleReview()}
                  onClear={handleClear}
                />
              ) : pr && account ? (
                <PrFiles pr={pr} account={account} selected={selected} disabled={running} onToggle={handleToggleFile} commentCounts={commentCounts} />
              ) : (
                <div className="ds-state ds-state--empty">
                  <span className="ds-state__mark" aria-hidden="true" />
                  <p className="ds-state__title">No pull request loaded</p>
                  <p className="ds-state__body">Load a public pull request to see its files and choose what the review reads.</p>
                </div>
              )}
            </div>
            <RunTrace phase={phase} summary={summary} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
