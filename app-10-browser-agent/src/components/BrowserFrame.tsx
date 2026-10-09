import { useRef } from 'react'
import { middleTruncate } from '../lib/format'
import type { ReplayItem } from '../lib/replay'

/** Why there is no picture for a step, in words for the person looking at the empty frame. */
function emptyFrameText(item: ReplayItem): string {
  if (item.note) return item.note
  if (item.status === 'running') return 'The step is running. Its picture appears when the step ends.'
  if (item.status === 'waiting') return 'This step waits for the steps before it.'
  if (item.status === 'skipped') return 'This step did not run, so there is no picture.'
  return 'No picture was captured for this step.'
}

interface BrowserFrameProps {
  item?: ReplayItem
  /** Text for the empty frame before a run. */
  placeholder?: { title: string; body: string }
}

/**
 * A minimal browser window: an address bar over the picture of the page. The picture opens at its full
 * size in a dialog. Without a step it shows an empty window with the placeholder text.
 */
export default function BrowserFrame({ item, placeholder }: BrowserFrameProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const observed = item?.observed
  const frame = item?.frame
  const title = observed?.title || observed?.url || item?.label || ''
  const failed = item?.status === 'failed'

  return (
    <div className={`bb-window${failed ? ' bb-window--failed' : ''}`}>
      <div className="bb-bar">
        <span className="bb-bar__url ds-mono" title={observed?.url}>{observed ? middleTruncate(observed.url) : 'No page yet'}</span>
        {observed?.title ? <span className="bb-bar__title" title={observed.title}>{observed.title}</span> : null}
      </div>
      <div
        className="ds-frame bb-shot"
        style={frame ? { aspectRatio: `${frame.width} / ${frame.height}` } : undefined}
      >
        {frame && item ? (
          <>
            <button
              type="button"
              ref={opener}
              className="bb-shot__open"
              aria-label={`Open the picture of step ${item.index + 1} at full size`}
              onClick={() => dialog.current?.showModal()}
            >
              <img src={`data:image/jpeg;base64,${frame.data}`} width={frame.width} height={frame.height} alt={`The page after step ${item.index + 1}, ${title}`} />
            </button>
            {failed ? <span className="bb-shot__tag">Page when step {item.index + 1} failed</span> : null}
            {item.sameAs !== undefined ? <span className="bb-shot__same">Same page as step {item.sameAs + 1}</span> : null}
            <dialog
              ref={dialog}
              className="ds-dialog bb-dialog"
              aria-label={`Step ${item.index + 1} picture`}
              onClose={() => opener.current?.focus()}
              onClick={(event) => {
                if (event.target === event.currentTarget) event.currentTarget.close()
              }}
            >
              <img src={`data:image/jpeg;base64,${frame.data}`} width={frame.width} height={frame.height} alt="" />
              <div className="ds-dialog__actions">
                <button type="button" className="ds-button" onClick={() => dialog.current?.close()}>Close</button>
              </div>
            </dialog>
          </>
        ) : (
          <div className="bb-shot__empty">
            {placeholder ? <p className="bb-shot__title" tabIndex={-1} data-result-focus>{placeholder.title}</p> : null}
            <p>{placeholder ? placeholder.body : item ? emptyFrameText(item) : ''}</p>
          </div>
        )}
      </div>
    </div>
  )
}
