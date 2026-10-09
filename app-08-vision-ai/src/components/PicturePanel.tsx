import type { CommonsImage } from '../lib/commons'
import { useFileDrop } from '../lib/useFileDrop'

interface PicturePanelProps {
  imageUrl: string
  fileName: string
  credit: CommonsImage | null
  disabled: boolean
  onFile: (file: File) => void
  onZoom: () => void
}

export default function PicturePanel({ imageUrl, fileName, credit, disabled, onFile, onZoom }: PicturePanelProps) {
  const { dragging, dropProps } = useFileDrop(onFile, disabled)

  return (
    <div className={dragging ? 'picture is-dragging' : 'picture'} {...dropProps}>
      {imageUrl ? (
        <figure className="ds-panel picture__frame">
          <img src={imageUrl} alt={`Image to analyze: ${fileName}`} />
          <figcaption className="picture__name">{fileName}</figcaption>
          {credit && <Credit image={credit} />}
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={onZoom}>
              View full size
            </button>
          </div>
        </figure>
      ) : (
        <div className="ds-empty">No picture yet. Choose one to begin, or paste a screenshot with Ctrl+V.</div>
      )}
    </div>
  )
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
