import React, { useEffect, useMemo, useRef, useState } from 'react'

type VideoStatus =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'ready'; stream: MediaStream }
  | { kind: 'error'; message: string }

export function VideoShowBackgroundApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<VideoStatus>({ kind: 'idle' })

  const overlayText = useMemo(() => {
    if (status.kind === 'requesting') return '正在请求摄像头权限…'
    if (status.kind === 'error') return status.message
    return ''
  }, [status])

  useEffect(() => {
    let stopped = false
    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: '当前环境不支持摄像头' })
        return
      }

      setStatus({ kind: 'requesting' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
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
  }, [])

  useEffect(() => {
    if (status.kind !== 'ready') return
    const video = videoRef.current
    if (!video) return
    video.srcObject = status.stream
    void video.play().catch(() => undefined)
    return () => {
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
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: status.kind === 'ready' ? 'block' : 'none'
        }}
      />
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
            userSelect: 'none'
          }}
        >
          {overlayText}
        </div>
      ) : null}
    </div>
  )
}

