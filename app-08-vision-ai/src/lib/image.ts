import { cropRect, shrinkFactor, type Box, type PixelRect } from './region'
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

// Two images share one request, so each image of a comparison has to fit in 2 MB (the server enforces the same limit).
export const MAX_COMPARE_BYTES = 2 * 1024 * 1024
const COMPARE_START_EDGE = 1600
const SHRINK_PASSES = 6

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

export interface CropResult {
  file: File
  rect: PixelRect
  source: { width: number; height: number }
}

/**
 * Cuts the box out of the picture at its own pixel size: no scaling, so small print stays readable.
 * PNG and GIF sources stay PNG, everything else becomes a high-quality JPEG. Only when the crop is over the
 * 4 MB limit is it scaled down, in steps, until it fits.
 */
export async function cropRegion(file: File, box: Box): Promise<CropResult> {
  const bitmap = await createImageBitmap(file)
  try {
    const source = { width: bitmap.width, height: bitmap.height }
    const rect = cropRect(box, source.width, source.height)
    const lossless = file.type === 'image/png' || file.type === 'image/gif'
    const type = lossless ? 'image/png' : 'image/jpeg'
    let scale = 1
    for (let pass = 0; pass < SHRINK_PASSES; pass += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(rect.width * scale))
      canvas.height = Math.max(1, Math.round(rect.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No canvas')
      ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
      const blob = await encode(canvas, type, 0.92)
      if (!blob) throw new Error('Could not encode the crop')
      if (blob.size <= MAX_FILE_SIZE) {
        const name = `region-${rect.width}x${rect.height}.${lossless ? 'png' : 'jpg'}`
        return { file: new File([blob], name, { type }), rect, source }
      }
      scale *= shrinkFactor(blob.size, MAX_FILE_SIZE)
    }
    throw new Error('The crop is too large')
  } finally {
    bitmap.close()
  }
}

/** Returns the image itself when it already fits 2 MB, otherwise a JPEG scaled down until it does. */
export async function fitForCompare(file: File): Promise<{ file: File; shrunk: boolean }> {
  if (file.size <= MAX_COMPARE_BYTES) return { file, shrunk: false }
  const bitmap = await createImageBitmap(file)
  try {
    let edge = COMPARE_START_EDGE
    for (let pass = 0; pass < SHRINK_PASSES; pass += 1) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No canvas')
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await encode(canvas, 'image/jpeg', 0.85)
      if (!blob) throw new Error('Could not encode the image')
      if (blob.size <= MAX_COMPARE_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
        return { file: new File([blob], name, { type: 'image/jpeg' }), shrunk: true }
      }
      edge = Math.round(edge * shrinkFactor(blob.size, MAX_COMPARE_BYTES))
    }
    throw new Error('The image is too large')
  } finally {
    bitmap.close()
  }
}
