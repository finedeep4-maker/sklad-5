export async function compressImage(file: File, maxSize = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      let { width, height } = bitmap
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width)
          width = maxSize
        } else {
          width = Math.round((width * maxSize) / height)
          height = maxSize
        }
      }
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height })
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas not supported')
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await (canvas instanceof OffscreenCanvas
        ? canvas.convertToBlob({ type: 'image/jpeg', quality })
        : new Promise<Blob | null>((resolve) =>
            (canvas as HTMLCanvasElement).toBlob(resolve, 'image/jpeg', quality),
          ))
      if (!blob) throw new Error('Compression failed')
      return blob
    } finally {
      bitmap.close?.()
    }
  } catch {
    return compressImageFallback(file, maxSize, quality)
  }
}

function compressImageFallback(file: File, maxSize: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        URL.revokeObjectURL(url)
      } catch { /* ignore */ }
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width)
          width = maxSize
        } else {
          width = Math.round((width * maxSize) / height)
          height = maxSize
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error('Compression failed')) },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      try { URL.revokeObjectURL(url) } catch { /* ignore */ }
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
}
