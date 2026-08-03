const THUMBNAIL_MAX_EDGE = 96
const THUMBNAIL_QUALITY = 0.7

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
