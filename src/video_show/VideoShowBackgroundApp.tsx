import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY,
  VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY,
  VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY,
  VIDEO_SHOW_MERGE_LAYERS_KV_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
  VIDEO_SHOW_PAGES_KV_KEY,
  VIDEO_SHOW_QUALITY_UI_STATE_KEY,
  VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY,
  VIDEO_SHOW_SOURCE_UI_STATE_KEY,
  VIDEO_SHOW_VIEW_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY,
  getKv,
  putKv,
  useUiStateBus
} from '../status'
import { AnnotationOverlayApp } from '../annotation_writing/leaferjs'

type VideoStatus =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'ready'; stream: MediaStream }
  | { kind: 'error'; message: string }

type VideoShowPageV1 = { name: string; imageUrl: string; createdAt: number }
type VideoShowPageBookV1 = { version: 1; pages: VideoShowPageV1[] }

let rotatedVideoShowPages = false
let lastVideoShowQualityPresetsKey = ''

function isVideoShowPageBookV1(v: unknown): v is VideoShowPageBookV1 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 1) return false
  if (!Array.isArray(b.pages)) return false
  return true
}

function computeVideoShowThreeQualityHeights(maxHeight: number): [number, number, number] {
  const std = [2160, 1440, 1080, 900, 720, 540, 480, 360, 240] as const
  const mh = Number.isFinite(maxHeight) ? Math.max(1, Math.floor(maxHeight)) : 1080
  let startIdx = std.findIndex((h) => h <= mh)
  if (startIdx < 0) startIdx = std.length - 1
  const h0 = std[startIdx] ?? 1080
  const h1 = std[Math.min(std.length - 1, startIdx + 1)] ?? 720
  const h2 = std[Math.min(std.length - 1, startIdx + 2)] ?? 480
  return [h0, h1, h2]
}

function parseVideoShowQualityIndex(raw: unknown): number {
  if (raw === '0' || raw === 0) return 0
  if (raw === '1' || raw === 1) return 1
  if (raw === '2' || raw === 2) return 2
  if (raw === '1080p') return 0
  if (raw === '720p') return 1
  if (raw === '480p') return 2
  if (raw === '360p') return 2
  return 0
}

function coercePageIndexTotal(indexRaw: unknown, totalRaw: unknown): { index: number; total: number } {
  const totalV = typeof totalRaw === 'number' ? totalRaw : typeof totalRaw === 'string' ? Number(totalRaw) : 1
  const indexV = typeof indexRaw === 'number' ? indexRaw : typeof indexRaw === 'string' ? Number(indexRaw) : 0
  const total = Number.isFinite(totalV) ? Math.max(1, Math.floor(totalV)) : 1
  const index = Number.isFinite(indexV) ? Math.max(0, Math.min(total - 1, Math.floor(indexV))) : 0
  return { index, total }
}

function normalizeVideoShowBook(loaded: unknown, photoTotal: number): VideoShowPageBookV1 {
  const base: VideoShowPageBookV1 = isVideoShowPageBookV1(loaded) ? loaded : { version: 1, pages: [] }
  const pages = Array.isArray(base.pages) ? [...base.pages] : []

  if (pages.length < photoTotal) while (pages.length < photoTotal) pages.push({ name: '', imageUrl: '', createdAt: 0 })
  else if (pages.length > photoTotal) pages.length = photoTotal
  return { version: 1, pages }
}

function captureVideoFrameToDataUrl(video: HTMLVideoElement, options: { maxSide: number; quality: number }, canvas?: HTMLCanvasElement): string | null {
  const vw = Math.max(1, Math.floor(video.videoWidth))
  const vh = Math.max(1, Math.floor(video.videoHeight))
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 1 || vh <= 1) return null

  const maxSide = Math.max(128, Math.floor(options.maxSide))
  const scale = Math.min(1, maxSide / Math.max(vw, vh))
  const w = Math.max(1, Math.floor(vw * scale))
  const h = Math.max(1, Math.floor(vh * scale))

  const c = canvas ?? document.createElement('canvas')
  if (c.width !== w) c.width = w
  if (c.height !== h) c.height = h
  const ctx = c.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, w, h)
  try {
    return c.toDataURL('image/jpeg', Math.max(0.1, Math.min(1, options.quality)))
  } catch {
    return null
  }
}

async function captureVideoFrameToJpegDataUrlAsync(
  video: HTMLVideoElement,
  options: { maxSide: number; quality: number },
  canvas: HTMLCanvasElement
): Promise<string | null> {
  const vw = Math.max(1, Math.floor(video.videoWidth))
  const vh = Math.max(1, Math.floor(video.videoHeight))
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 1 || vh <= 1) return null

  const maxSide = Math.max(128, Math.floor(options.maxSide))
  const scale = Math.min(1, maxSide / Math.max(vw, vh))
  const w = Math.max(1, Math.floor(vw * scale))
  const h = Math.max(1, Math.floor(vh * scale))

  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, w, h)

  const quality = Math.max(0.1, Math.min(1, options.quality))
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    } catch {
      resolve(null)
    }
  })
  if (!blob) return null

  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    try {
      reader.readAsDataURL(blob)
    } catch {
      resolve(null)
    }
  })
}

export function VideoShowBackgroundApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const liveThumbCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const liveThumbBusyRef = useRef(false)
  const [status, setStatus] = useState<VideoStatus>({ kind: 'idle' })
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const setUiStateKeyRef = useRef(bus.setKey)

  useEffect(() => {
    setUiStateKeyRef.current = bus.setKey
  }, [bus.setKey])

  const pageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageTotalRaw = bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]
  const { index, total } = useMemo(() => coercePageIndexTotal(pageIndexRaw, pageTotalRaw), [pageIndexRaw, pageTotalRaw])
  const photoTotal = Math.max(0, total - 1)

  const viewRaw = bus.state[VIDEO_SHOW_VIEW_UI_STATE_KEY]
  const view = useMemo(() => {
    if (!viewRaw || typeof viewRaw !== 'object') return null
    const v = viewRaw as any
    const x = Number(v.x)
    const y = Number(v.y)
    const scale = Number(v.scale)
    const rot = Number(v.rot)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) || !Number.isFinite(rot)) return null
    return { x, y, scale: Math.max(0.0001, scale), rot }
  }, [viewRaw])

  useEffect(() => {
    if (!view) return
    const w = Math.max(1, Math.floor(window.innerWidth || 1))
    const h = Math.max(1, Math.floor(window.innerHeight || 1))
    const maxSide = Math.max(w, h)
    const maxTranslate = maxSide * 8
    const minScale = 0.05
    const maxScale = 8
    const maxRot = Math.PI * 4
    const bad =
      Math.abs(view.x) > maxTranslate ||
      Math.abs(view.y) > maxTranslate ||
      view.scale < minScale ||
      view.scale > maxScale ||
      Math.abs(view.rot) > maxRot
    if (!bad) return
    setUiStateKeyRef.current(VIDEO_SHOW_VIEW_UI_STATE_KEY, { x: 0, y: 0, scale: 1, rot: 0 }).catch(() => undefined)
  }, [viewRaw])

  useEffect(() => {
    if (!view) return
    const w = Math.max(1, Math.floor(window.innerWidth || 1))
    const h = Math.max(1, Math.floor(window.innerHeight || 1))

    const scale = view.scale
    const rot = view.rot
    const a = Math.cos(rot) * scale
    const b = Math.sin(rot) * scale
    const c = -Math.sin(rot) * scale
    const d = Math.cos(rot) * scale
    const e = view.x
    const f = view.y

    const map = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f })
    const p0 = map(0, 0)
    const p1 = map(w, 0)
    const p2 = map(0, h)
    const p3 = map(w, h)

    const minX = Math.min(p0.x, p1.x, p2.x, p3.x)
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x)
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y)
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y)

    const margin = Math.max(32, Math.floor(Math.min(w, h) * 0.06))
    const offscreen = maxX < -margin || minX > w + margin || maxY < -margin || minY > h + margin
    if (!offscreen) return

    setUiStateKeyRef.current(VIDEO_SHOW_VIEW_UI_STATE_KEY, { x: 0, y: 0, scale: 1, rot: 0 }).catch(() => undefined)
  }, [viewRaw])

  const viewTransform = useMemo(() => {
    const x = view?.x ?? 0
    const y = view?.y ?? 0
    const scale = view?.scale ?? 1
    const rot = view?.rot ?? 0
    const cos = Math.cos(rot) * scale
    const sin = Math.sin(rot) * scale
    return `matrix(${cos} ${sin} ${-sin} ${cos} ${x} ${y})`
  }, [view])

  const deviceIdRaw = bus.state[VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY]
  const qualityRaw = bus.state[VIDEO_SHOW_QUALITY_UI_STATE_KEY]
  const deviceId = typeof deviceIdRaw === 'string' ? deviceIdRaw : ''
  const qualityIdx = useMemo(() => parseVideoShowQualityIndex(qualityRaw), [qualityRaw])

  const sourceRaw = bus.state[VIDEO_SHOW_SOURCE_UI_STATE_KEY]
  const videoSource = useMemo(() => (sourceRaw === 'phone-webrtc' ? ('phone-webrtc' as const) : ('camera' as const)), [sourceRaw])

  const webrtcSessionIdRaw = bus.state[VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY]
  const webrtcSessionId = useMemo(() => (typeof webrtcSessionIdRaw === 'string' ? webrtcSessionIdRaw : ''), [webrtcSessionIdRaw])

  const mergeLayersRaw = bus.state[VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY]
  const [mergeLayers, setMergeLayers] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const loaded = await getKv<unknown>(VIDEO_SHOW_MERGE_LAYERS_KV_KEY)
        if (cancelled) return
        if (typeof loaded !== 'boolean') return
        setMergeLayers(loaded)
      } catch {
        return
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof mergeLayersRaw !== 'boolean') return
    setMergeLayers(mergeLayersRaw)
  }, [mergeLayersRaw])

  const qualityPresetsRaw = bus.state[VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY]
  const qualityPresetsHeights = useMemo(() => {
    const raw = qualityPresetsRaw as any
    const heights = Array.isArray(raw?.heights) ? raw.heights.map((v: any) => Number(v)).filter((n: any) => Number.isFinite(n) && n > 0) : []
    const fallback: [number, number, number] = [1080, 720, 480]
    if (heights.length >= 3) return [Math.floor(heights[0]), Math.floor(heights[1]), Math.floor(heights[2])] as [number, number, number]
    if (heights.length === 2) return [Math.floor(heights[0]), Math.floor(heights[1]), fallback[2]] as [number, number, number]
    if (heights.length === 1) return [Math.floor(heights[0]), fallback[1], fallback[2]] as [number, number, number]
    return fallback
  }, [qualityPresetsRaw])
  const desiredHeight = qualityPresetsHeights[Math.max(0, Math.min(2, qualityIdx))]
  const desiredWidth = useMemo(() => Math.max(1, Math.floor((desiredHeight * 16) / 9)), [desiredHeight])

  const captureRaw = bus.state[VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY]
  const capture = useMemo(() => {
    if (!captureRaw || typeof captureRaw !== 'object') return null
    const c = captureRaw as any
    const rev = Number(c.rev)
    const idx = Number(c.index)
    const tot = Number(c.total)
    if (!Number.isFinite(rev) || !Number.isFinite(idx) || !Number.isFinite(tot)) return null
    const boundedTotal = Math.max(1, Math.floor(tot))
    const boundedIndex = Math.max(0, Math.min(boundedTotal - 1, Math.floor(idx)))
    const name = typeof c.name === 'string' ? c.name : ''
    return { rev: Math.floor(rev), index: boundedIndex, total: boundedTotal, name }
  }, [captureRaw])

  const [photoPages, setPhotoPages] = useState<VideoShowPageV1[]>([])
  const lastCaptureRevRef = useRef(0)

  const overlayText = useMemo(() => {
    if (status.kind === 'error') return status.message
    if (status.kind === 'requesting') return videoSource === 'camera' ? '正在启动摄像头…' : '正在连接手机…'
    return ''
  }, [status, videoSource])

  useEffect(() => {
    if (rotatedVideoShowPages) return
    rotatedVideoShowPages = true
    let cancelled = false
    const run = async () => {
      try {
        const loaded = await getKv<unknown>(VIDEO_SHOW_PAGES_KV_KEY)
        if (cancelled) return
        if (isVideoShowPageBookV1(loaded) && Array.isArray(loaded.pages) && loaded.pages.length > 0) {
          await putKv(`${VIDEO_SHOW_PAGES_KV_KEY}-prev`, loaded)
        }
      } catch {}
      try {
        if (cancelled) return
        await putKv(VIDEO_SHOW_PAGES_KV_KEY, { version: 1, pages: [] })
        if (!cancelled) setPhotoPages([])
      } catch {}
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const run = async () => {
      if (videoSource !== 'camera') return
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: '当前环境不支持摄像头' })
        return
      }

      setStatus({ kind: 'requesting' })
      try {
        const baseVideo: MediaTrackConstraints = {}
        if (deviceId) baseVideo.deviceId = { exact: deviceId }
        const idealH = Number.isFinite(desiredHeight) ? desiredHeight : 1080
        const idealW = Number.isFinite(desiredWidth) ? desiredWidth : 1920
        baseVideo.width = { ideal: idealW }
        baseVideo.height = { ideal: idealH }

        const p = navigator.mediaDevices.getUserMedia({ video: Object.keys(baseVideo).length ? baseVideo : true, audio: false })
        p.then((stream) => {
          if (!stopped) return
          for (const t of stream.getTracks()) {
            try {
              t.stop()
            } catch {}
          }
        }).catch(() => undefined)

        const stream = await Promise.race([
          p,
          new Promise<MediaStream>((_resolve, reject) => window.setTimeout(() => reject(new Error('摄像头启动超时')), 9000))
        ])
        if (stopped) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        setStatus({ kind: 'ready', stream })
      } catch (e) {
        const msg = e instanceof Error ? e.message : '摄像头启动失败'
        setStatus({ kind: 'error', message: msg })
      }
    }

    run()
    return () => {
      stopped = true
    }
  }, [deviceId, desiredHeight, desiredWidth, qualityIdx, videoSource])

  useEffect(() => {
    if (videoSource !== 'phone-webrtc') return
    let cancelled = false
    let pc: RTCPeerConnection | null = null
    let stream: MediaStream | null = null

    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

    const setRtcStatus = (text: string) => {
      setUiStateKeyRef.current(VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY, text).catch(() => undefined)
    }

    const waitIceComplete = async (peer: RTCPeerConnection, timeoutMs: number) => {
      if (peer.iceGatheringState === 'complete') return
      await Promise.race([
        new Promise<void>((resolve) => {
          const onChange = () => {
            if (peer.iceGatheringState === 'complete') {
              peer.removeEventListener('icegatheringstatechange', onChange)
              resolve()
            }
          }
          peer.addEventListener('icegatheringstatechange', onChange)
        }),
        sleep(timeoutMs)
      ])
    }

    const run = async () => {
      setStatus({ kind: 'requesting' })
      setRtcStatus('初始化')

      let sessionId = webrtcSessionId
      if (!sessionId) {
        setRtcStatus('创建会话')
        const res = await window.lanstart?.apiRequest({ method: 'POST', path: '/webrtc/session', body: {} })
        const body = (res as any)?.body as any
        sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (!sessionId) {
          setRtcStatus('创建会话失败')
          setStatus({ kind: 'error', message: '创建投屏会话失败' })
          return
        }
        await setUiStateKeyRef.current(VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY, sessionId).catch(() => undefined)
      }

      if (cancelled) return
      setRtcStatus('等待手机连接')

      let offer: RTCSessionDescriptionInit | null = null
      for (;;) {
        if (cancelled) return
        const res = await window.lanstart?.apiRequest({ method: 'GET', path: `/webrtc/session/${encodeURIComponent(sessionId)}/offer` })
        const statusCode = Number((res as any)?.status ?? 0)
        const body = (res as any)?.body as any
        const o = body?.offer as any
        if (statusCode === 200 && o && typeof o.type === 'string' && typeof o.sdp === 'string') {
          offer = { type: o.type, sdp: o.sdp }
          break
        }
        await sleep(700)
      }

      if (cancelled || !offer) return

      stream = new MediaStream()
      pc = new RTCPeerConnection({ iceServers: [] })
      pc.ontrack = (ev) => {
        const track = ev.track
        if (!track) return
        try {
          const existed = stream?.getTracks().some((t) => t.id === track.id)
          if (!existed) stream?.addTrack(track)
        } catch {}
        if (!cancelled && stream) setStatus({ kind: 'ready', stream })
      }
      pc.onconnectionstatechange = () => setRtcStatus(pc?.connectionState ?? '')

      setRtcStatus('建立连接')
      await pc.setRemoteDescription(offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await waitIceComplete(pc, 2500)
      const finalAnswer = pc.localDescription
      if (!finalAnswer) throw new Error('no_local_description')
      await window.lanstart?.apiRequest({
        method: 'POST',
        path: `/webrtc/session/${encodeURIComponent(sessionId)}/answer`,
        body: { type: finalAnswer.type, sdp: finalAnswer.sdp }
      })
      setRtcStatus('等待连通')
    }

    run().catch((e) => {
      if (cancelled) return
      const msg = e instanceof Error ? e.message : '手机投屏连接失败'
      setRtcStatus(`错误：${msg}`)
      setStatus({ kind: 'error', message: msg })
    })

    return () => {
      cancelled = true
      setRtcStatus('')
      try {
        pc?.close()
      } catch {}
      for (const t of stream?.getTracks?.() ?? []) {
        try {
          t.stop()
        } catch {}
      }
    }
  }, [videoSource, webrtcSessionId])

  useEffect(() => {
    if (status.kind !== 'ready') return
    const video = videoRef.current
    if (!video) return
    video.srcObject = status.stream
    const tryPlay = () => void video.play().catch(() => undefined)
    video.addEventListener('loadedmetadata', tryPlay)
    video.addEventListener('canplay', tryPlay)
    tryPlay()
    return () => {
      video.removeEventListener('loadedmetadata', tryPlay)
      video.removeEventListener('canplay', tryPlay)
      try {
        video.pause()
      } catch {}
      try {
        video.srcObject = null
      } catch {}
      for (const t of status.stream.getTracks()) {
        try {
          t.stop()
        } catch {}
      }
    }
  }, [status])

  useEffect(() => {
    if (status.kind !== 'ready') return
    if (videoSource !== 'camera') return
    const track = status.stream.getVideoTracks()[0]
    if (!track) return
    const getMaxHeight = () => {
      try {
        const caps = (track as any).getCapabilities?.() as MediaTrackCapabilities | undefined
        const max = (caps as any)?.height?.max
        if (typeof max === 'number' && Number.isFinite(max) && max > 0) return max
      } catch {}
      try {
        const s = track.getSettings?.()
        const h = (s as any)?.height
        if (typeof h === 'number' && Number.isFinite(h) && h > 0) return h
      } catch {}
      return 1080
    }

    const heights = computeVideoShowThreeQualityHeights(getMaxHeight())
    const nextKey = heights.join(',')
    if (nextKey !== lastVideoShowQualityPresetsKey) {
      lastVideoShowQualityPresetsKey = nextKey
      setUiStateKeyRef.current(VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY, { heights }).catch(() => undefined)
    }

    const idx = Math.max(0, Math.min(2, qualityIdx))
    const wantH = heights[idx]
    const wantW = Math.max(1, Math.floor((wantH * 16) / 9))
    try {
      ;(track as any).applyConstraints?.({ width: { ideal: wantW }, height: { ideal: wantH } })
    } catch {}
  }, [status.kind, qualityIdx, deviceId, videoSource])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const loaded = await getKv<unknown>(VIDEO_SHOW_PAGES_KV_KEY)
        if (cancelled) return
        const book = normalizeVideoShowBook(loaded, photoTotal)
        setPhotoPages(book.pages)
      } catch {
        if (!cancelled) setPhotoPages(normalizeVideoShowBook(undefined, photoTotal).pages)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [photoTotal, capture?.rev])

  useEffect(() => {
    if (!capture) return
    if (capture.rev <= lastCaptureRevRef.current) return
    if (status.kind !== 'ready') return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    const run = async () => {
      const waitStart = Date.now()
      while (!cancelled && Date.now() - waitStart < 2500) {
        if (video.videoWidth > 1 && video.videoHeight > 1) break
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
      }
      if (cancelled) return
      const canvas = captureCanvasRef.current ?? (captureCanvasRef.current = document.createElement('canvas'))
      const dataUrl = captureVideoFrameToDataUrl(video, { maxSide: 960, quality: 0.82 }, canvas)
      if (!dataUrl) return
      if (capture.index <= 0) return

      try {
        const loaded = await getKv<unknown>(VIDEO_SHOW_PAGES_KV_KEY)
        const book = normalizeVideoShowBook(loaded, Math.max(0, capture.total - 1))
        const photoIndex = Math.max(0, capture.index - 1)
        book.pages[photoIndex] = { name: capture.name || '', imageUrl: dataUrl, createdAt: capture.rev }
        await putKv(VIDEO_SHOW_PAGES_KV_KEY, book)
        setPhotoPages(book.pages)
        lastCaptureRevRef.current = capture.rev
      } catch {
        return
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [capture, status])

  useEffect(() => {
    if (status.kind !== 'ready') return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      if (video.videoWidth <= 1 || video.videoHeight <= 1) return
      if (liveThumbBusyRef.current) return
      liveThumbBusyRef.current = true
      try {
        const canvas = liveThumbCanvasRef.current ?? (liveThumbCanvasRef.current = document.createElement('canvas'))
        const dataUrl = await captureVideoFrameToJpegDataUrlAsync(video, { maxSide: 240, quality: 0.6 }, canvas)
        if (!dataUrl) return
        setUiStateKeyRef.current(VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY, dataUrl).catch(() => undefined)
      } finally {
        liveThumbBusyRef.current = false
      }
    }
    const id = window.setInterval(() => void tick(), 1400)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [status.kind])

  const currentPhoto = index > 0 ? photoPages[index - 1] : undefined
  const frozenUrl =
    currentPhoto && typeof currentPhoto.imageUrl === 'string' && currentPhoto.imageUrl ? currentPhoto.imageUrl : ''

  useEffect(() => {
    if (!mergeLayers) return
    if (status.kind !== 'ready') return
    if (frozenUrl) return

    const video = videoRef.current
    const canvas = renderCanvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let cancelled = false

    const resize = () => {
      const dpr = typeof window.devicePixelRatio === 'number' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
      const w = Math.max(1, Math.floor(window.innerWidth * dpr))
      const h = Math.max(1, Math.floor(window.innerHeight * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
    }

    const draw = () => {
      if (cancelled) return
      if (video.videoWidth > 1 && video.videoHeight > 1) {
        const cw = canvas.width
        const ch = canvas.height
        const vw = video.videoWidth
        const vh = video.videoHeight
        const s = Math.min(cw / vw, ch / vh)
        const dw = vw * s
        const dh = vh * s
        const dx = (cw - dw) / 2
        const dy = (ch - dh) / 2
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, cw, ch)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, cw, ch)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(video, dx, dy, dw, dh)
      }
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)

    return () => {
      cancelled = true
      window.removeEventListener('resize', resize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [frozenUrl, mergeLayers, status.kind])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transform: viewTransform, transformOrigin: '0 0' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: mergeLayers ? 2 : '100%',
            height: mergeLayers ? 2 : '100%',
            objectFit: 'contain',
            position: mergeLayers ? 'absolute' : 'static',
            left: mergeLayers ? 0 : undefined,
            top: mergeLayers ? 0 : undefined,
            opacity: mergeLayers ? 0 : 1,
            pointerEvents: 'none',
            display: status.kind === 'ready' && !frozenUrl ? 'block' : 'none'
          }}
        />
        <canvas
          ref={renderCanvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: status.kind === 'ready' && !frozenUrl && mergeLayers ? 'block' : 'none'
          }}
        />
        {frozenUrl ? <img src={frozenUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : null}
      </div>
      {mergeLayers ? (
        <div style={{ position: 'absolute', inset: 0 }}>
          <AnnotationOverlayApp />
        </div>
      ) : null}
      {overlayText ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 14,
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        >
          {overlayText}
        </div>
      ) : null}
    </div>
  )
}
