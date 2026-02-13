import React from 'react'
import {
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  PDF_FILE_URL_KV_KEY,
  PDF_FILE_URL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  isFileOrDataUrl,
  usePersistedState,
  useUiStateBus
} from '../status'
import { loadPdfjs } from './pdfjs'

export function PdfBackgroundApp() {
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const busRef = React.useRef(bus)
  busRef.current = bus
  const [persistedFileUrl] = usePersistedState(PDF_FILE_URL_KV_KEY, '', { validate: isFileOrDataUrl })
  const uiFileUrl = bus.state[PDF_FILE_URL_UI_STATE_KEY]
  const fileUrl = isFileOrDataUrl(uiFileUrl) ? String(uiFileUrl ?? '') : persistedFileUrl

  const pageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageIndex = typeof pageIndexRaw === 'number' ? pageIndexRaw : typeof pageIndexRaw === 'string' ? Number(pageIndexRaw) : 0
  const pageIndexRef = React.useRef(pageIndex)
  pageIndexRef.current = pageIndex
  const clampedPageIndexRef = React.useRef(0)

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const docRef = React.useRef<any>(null)
  const loadTaskRef = React.useRef<any>(null)
  const renderTaskRef = React.useRef<any>(null)
  const pdfTokenRef = React.useRef<string | null>(null)
  const [docPages, setDocPages] = React.useState(0)
  const [resizeRev, setResizeRev] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [loadingRatio, setLoadingRatio] = React.useState<number | null>(null)

  const base64ToU8 = React.useCallback((base64: string): Uint8Array => {
    const raw = globalThis.atob(base64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff
    return out
  }, [])

  React.useEffect(() => {
    const onResize = () => setResizeRev((v) => (v + 1) % 1_000_000_000)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const last = docRef.current
    docRef.current = null
    setDocPages(0)
    clampedPageIndexRef.current = 0
    setLoading(false)
    setLoadingRatio(null)

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel()
      } catch {}
      renderTaskRef.current = null
    }

    if (loadTaskRef.current) {
      try {
        loadTaskRef.current.destroy?.()
      } catch {}
      loadTaskRef.current = null
    }

    if (last) {
      try {
        last.destroy?.()
      } catch {}
    }

    const lastToken = pdfTokenRef.current
    pdfTokenRef.current = null
    if (lastToken) {
      window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/close', body: { token: lastToken } }).catch(() => undefined)
    }

    if (!fileUrl) {
      busRef.current.setKey(NOTES_PAGE_TOTAL_UI_STATE_KEY, 1).catch(() => undefined)
      busRef.current.setKey(NOTES_PAGE_INDEX_UI_STATE_KEY, 0).catch(() => undefined)
      return
    }

    ;(async () => {
      let token: string | null = null
      try {
        setLoading(true)
        setLoadingRatio(null)
        const pdfjs = await loadPdfjs()

        const openRes = await window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/open', body: { fileUrl } })
        const openBody = (openRes as any)?.body as any
        if ((openRes as any)?.status !== 200 || openBody?.ok !== true) throw new Error(String(openBody?.error ?? 'PDF_OPEN_FAILED'))
        token = typeof openBody?.token === 'string' ? openBody.token : ''
        const size = Number(openBody?.size ?? 0)
        if (!token || !Number.isFinite(size) || size <= 0) throw new Error('PDF_OPEN_FAILED')
        pdfTokenRef.current = token

        const data = new Uint8Array(size)
        const chunkLen = 512 * 1024
        let offset = 0
        let lastProgressAt = 0
        while (offset < size) {
          if (cancelled) return
          const url = `/pdf/chunk/${encodeURIComponent(token)}?offset=${offset}&length=${chunkLen}`
          const res = await window.lanstart?.apiRequest({ method: 'GET', path: url })
          const body = (res as any)?.body as any
          if ((res as any)?.status !== 200 || body?.ok !== true) throw new Error(String(body?.error ?? 'PDF_CHUNK_FAILED'))
          const base64 = typeof body?.base64 === 'string' ? body.base64 : ''
          const bytesRead = Number(body?.length ?? 0)
          if (!base64 || !Number.isFinite(bytesRead) || bytesRead <= 0) throw new Error('PDF_CHUNK_FAILED')
          const chunk = base64ToU8(base64)
          data.set(chunk, offset)
          offset += bytesRead
          const now = Date.now()
          if (now - lastProgressAt > 80) {
            lastProgressAt = now
            setLoadingRatio(Math.max(0, Math.min(1, offset / size)))
          }
        }

        setLoadingRatio(1)

        const task = (pdfjs as any).getDocument({ data, length: size })
        loadTaskRef.current = task
        const doc = await task.promise
        if (cancelled) {
          try {
            doc.destroy?.()
          } catch {}
          return
        }
        docRef.current = doc
        loadTaskRef.current = null
        const total = Math.max(1, Number(doc?.numPages ?? 1))
        setDocPages(total)
        busRef.current.setKey(NOTES_PAGE_TOTAL_UI_STATE_KEY, total).catch(() => undefined)
        const boundedIndex = Number.isFinite(pageIndexRef.current)
          ? Math.max(0, Math.min(total - 1, Math.floor(pageIndexRef.current)))
          : 0
        clampedPageIndexRef.current = boundedIndex
        if (boundedIndex !== pageIndexRef.current) busRef.current.setKey(NOTES_PAGE_INDEX_UI_STATE_KEY, boundedIndex).catch(() => undefined)
        setLoading(false)
        setLoadingRatio(1)
      } catch {
        setLoading(false)
        setLoadingRatio(null)
        busRef.current.setKey(NOTES_PAGE_TOTAL_UI_STATE_KEY, 1).catch(() => undefined)
        busRef.current.setKey(NOTES_PAGE_INDEX_UI_STATE_KEY, 0).catch(() => undefined)
      } finally {
        if (token) {
          window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/close', body: { token } }).catch(() => undefined)
          if (pdfTokenRef.current === token) pdfTokenRef.current = null
        }
      }
    })()

    return () => {
      cancelled = true
      if (loadTaskRef.current) {
        try {
          loadTaskRef.current.destroy?.()
        } catch {}
        loadTaskRef.current = null
      }
    }
  }, [base64ToU8, fileUrl])

  React.useEffect(() => {
    const doc = docRef.current
    if (!doc) return
    const total = docPages > 0 ? docPages : Math.max(1, Number(doc?.numPages ?? 1))
    const boundedIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.min(total - 1, Math.floor(pageIndex))) : 0
    clampedPageIndexRef.current = boundedIndex
    if (boundedIndex !== pageIndex) busRef.current.setKey(NOTES_PAGE_INDEX_UI_STATE_KEY, boundedIndex).catch(() => undefined)

    const host = containerRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel()
      } catch {}
      renderTaskRef.current = null
    }

    let cancelled = false
    ;(async () => {
      try {
        const rect = host.getBoundingClientRect()
        const cssW = Math.max(1, Math.floor(rect.width))
        const cssH = Math.max(1, Math.floor(rect.height))
        const dprRaw = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1
        const dpr = Math.max(1, Math.min(4, dprRaw))

        const page = await doc.getPage(boundedIndex + 1)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const fitScale = Math.min(cssW / baseViewport.width, cssH / baseViewport.height)
        const viewport = page.getViewport({ scale: fitScale })
        const renderViewport = page.getViewport({ scale: fitScale * dpr })

        canvas.width = Math.max(1, Math.floor(renderViewport.width))
        canvas.height = Math.max(1, Math.floor(renderViewport.height))
        canvas.style.width = `${Math.max(1, Math.floor(viewport.width))}px`
        canvas.style.height = `${Math.max(1, Math.floor(viewport.height))}px`

        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true } as any) as CanvasRenderingContext2D | null
        if (!ctx) return

        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        const task = page.render({ canvasContext: ctx, viewport: renderViewport })
        renderTaskRef.current = task
        await task.promise
        if (cancelled) return
      } catch {
        return
      } finally {
        if (!cancelled) renderTaskRef.current = null
      }
    })()

    return () => {
      cancelled = true
    }
  }, [docPages, pageIndex, resizeRev])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#3a3a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}
    >
      <canvas ref={canvasRef} style={{ display: fileUrl ? 'block' : 'none' }} />
      {fileUrl && loading ? (
        <div
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.25)',
            pointerEvents: 'none'
          }}
        >
          <div style={{ width: 360, maxWidth: '70vw' }}>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${loadingRatio === null ? 35 : Math.round(loadingRatio * 100)}%`,
                  background: 'rgba(255,255,255,0.9)',
                  borderRadius: 999,
                  transition: loadingRatio === null ? undefined : 'width 120ms linear'
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
