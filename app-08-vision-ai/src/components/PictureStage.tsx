import type { CommonsImage } from '../lib/commons'
import type { Box } from '../lib/region'
import type { RegionEntry } from '../lib/useAnalysis'
import RegionFrame from './RegionFrame'

export interface Picture {
  url: string
  name: string
  credit: CommonsImage | null
}

interface PictureStageProps {
  comparing: boolean
  a: Picture | null
  b: Picture | null
  regions: RegionEntry[]
  activeRegionId: string | null
  draft: Box | null
  editable: boolean
  onDraft: (box: Box | null) => void
  onStart: () => void
  onZoom: (slot: 'a' | 'b') => void
}

// The attribution Commons licences ask for: title, author, licence, and a link back to the file page.
function Credit({ image }: { image: CommonsImage }) {
  return (
    <p className="picture__credit">
      <a href={image.pageUrl} target="_blank" rel="noreferrer">
        {image.title}
      </a>
      <span>by {image.author}</span>
      <span>
        {image.licenceUrl ? (
          <a href={image.licenceUrl} target="_blank" rel="noreferrer">
            {image.licence}
          </a>
        ) : (
          image.licence
        )}
        , via Wikimedia Commons
      </span>
    </p>
  )
}

interface FigureProps {
  slot: 'a' | 'b'
  label: string
  picture: Picture | null
  comparing: boolean
  props: PictureStageProps
}

function Figure({ slot, label, picture, comparing, props }: FigureProps) {
  if (!picture) {
    return (
      <div className="ds-state ds-state--empty vl-figure-empty">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">{label ? `No image ${label} yet` : 'No picture yet'}</p>
        <p className="ds-state__body">
          {label ? 'Choose or drop it in the Images section.' : 'Choose one to begin, or paste a screenshot with Ctrl+V.'}
        </p>
      </div>
    )
  }
  const editable = props.editable && slot === 'a'
  return (
    <figure className="vl-figure">
      {comparing && <span className="ds-chip vl-figure__label">Image {label}</span>}
      <RegionFrame
        src={picture.url}
        alt={`Image to analyze: ${picture.name}`}
        regions={slot === 'a' ? props.regions : []}
        activeId={props.activeRegionId}
        draft={slot === 'a' ? props.draft : null}
        editable={editable}
        onDraft={props.onDraft}
        onStart={props.onStart}
      />
      <figcaption className="picture__name">{picture.name}</figcaption>
      {picture.credit && <Credit image={picture.credit} />}
      <div className="ds-row">
        <button type="button" className="ds-button" onClick={() => props.onZoom(slot)}>
          View full size
        </button>
      </div>
    </figure>
  )
}

export default function PictureStage(props: PictureStageProps) {
  return (
    <div className={props.comparing ? 'vl-pictures vl-pictures--pair' : 'vl-pictures'}>
      <Figure slot="a" label={props.comparing ? 'A' : ''} picture={props.a} comparing={props.comparing} props={props} />
      {props.comparing && <Figure slot="b" label="B" picture={props.b} comparing props={props} />}
    </div>
  )
}
