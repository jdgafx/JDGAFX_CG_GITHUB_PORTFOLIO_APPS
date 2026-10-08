import { useFileDrop } from '../lib/useFileDrop'

interface PicturePanelProps {
  imageUrl: string
  fileName: string
  disabled: boolean
  onFile: (file: File) => void
  onZoom: () => void
}

export default function PicturePanel({ imageUrl, fileName, disabled, onFile, onZoom }: PicturePanelProps) {
  const { dragging, dropProps } = useFileDrop(onFile, disabled)

  return (
    <div className={dragging ? 'picture is-dragging' : 'picture'} {...dropProps}>
      {imageUrl ? (
        <figure className="ds-panel picture__frame">
          <img src={imageUrl} alt={`Image to analyze: ${fileName}`} />
          <figcaption className="picture__name">{fileName}</figcaption>
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
