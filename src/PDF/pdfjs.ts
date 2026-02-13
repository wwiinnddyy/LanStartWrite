let loadPdfjsPromise: Promise<any> | null = null

export async function loadPdfjs(): Promise<any> {
  if (loadPdfjsPromise) return loadPdfjsPromise
  loadPdfjsPromise = (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js')
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.js?url')).default
    try {
      ;(pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl
    } catch {}
    return pdfjs
  })()
  return loadPdfjsPromise
}
