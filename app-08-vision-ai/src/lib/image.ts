const THUMBNAIL_MAX_EDGE = 96
const THUMBNAIL_QUALITY = 0.7
export const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const ACCEPTED_LABEL = 'JPG, PNG, WebP, or GIF'

export function fileProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `Unsupported file type: ${file.type || 'unknown'}. Please use ${ACCEPTED_LABEL}.`
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
    return `Image is too large (${sizeMB} MB). Maximum size is 4 MB.`
  }
  return null
}

export interface DataUrlParts {
  data: string
  mediaType: string
}

// Splits a base64 data URL such as data:image/png;base64,... into its payload and media type.
// Anything else returns null.
export function parseDataUrl(url: string): DataUrlParts | null {
  const comma = url.indexOf(',')
  if (comma === -1) return null
  const header = /^data:([^;,]+);base64$/.exec(url.slice(0, comma))
  if (!header) return null
  return { data: url.slice(comma + 1), mediaType: header[1] }
}

/**
 * Downscales an image to a small JPEG and returns an object URL for it, so the
 * history strip holds ~KB thumbnails instead of full-resolution decodes.
 * Returns null when the browser cannot decode the file; callers fall back to
 * the full-size object URL.
 */
export async function createThumbnailUrl(file: File): Promise<string | null> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', THUMBNAIL_QUALITY)
    })
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}
