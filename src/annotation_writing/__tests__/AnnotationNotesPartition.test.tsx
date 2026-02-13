import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const SVG_LEAFER_SETTINGS = {
  multiTouch: false,
  inkSmoothing: true,
  showInkWhenPassthrough: true,
  freezeScreen: false,
  rendererEngine: 'svg',
  nibMode: 'off',
  postBakeOptimize: false,
  postBakeOptimizeOnce: false
} as const

describe('Annotation notes partition', () => {
  it('stores notes under mode-specific kv keys', async () => {
    vi.resetModules()
    ;(globalThis as any).CanvasRenderingContext2D ??= function CanvasRenderingContext2D() {}
    ;(globalThis as any).Path2D ??= function Path2D() {}
    ;(globalThis as any).PointerEvent ??= class PointerEvent extends MouseEvent {}
    ;(globalThis as any).DragEvent ??= class DragEvent extends MouseEvent {}
    ;(globalThis as any).ResizeObserver ??= class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    if (typeof HTMLCanvasElement !== 'undefined') {
      const noop = () => {}
      const ctx = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'canvas') return document.createElement('canvas')
            if (prop === 'measureText') return () => ({ width: 0 })
            if (prop === 'getLineDash') return () => []
            if (prop === 'getImageData')
              return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })
            if (prop === 'createImageData')
              return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })
            if (prop === 'isPointInPath') return () => false
            return noop
          },
          set: (target, prop, value) => {
            ;(target as any)[prop] = value
            return true
          },
        },
      ) as unknown as CanvasRenderingContext2D

      const originalGetContext = (HTMLCanvasElement.prototype as any).getContext
      ;(HTMLCanvasElement.prototype as any).getContext = function getContext(type: string) {
        if (type === '2d') return ctx
        return originalGetContext?.call(this, type) ?? ctx
      }
    }
    const { AnnotationOverlayApp } = await import('../leaferjs')

    const putCalls: Array<{ key: string; value: unknown }> = []

    window.lanstart = {
      postCommand: async () => null,
      getEvents: async () => ({ items: [], latest: 0 }),
      getKv: async (key: string) => {
        if (key === 'leafer-settings') return SVG_LEAFER_SETTINGS as any
        throw new Error('kv_not_found')
      },
      putKv: async (key: string, value: unknown) => {
        putCalls.push({ key, value })
        return null
      },
      getUiState: async () => ({
        mode: 'whiteboard',
        tool: 'pen',
        penType: 'writing',
        penColor: '#333333',
        penThickness: 6,
        eraserType: 'pixel',
        eraserThickness: 18
      }),
      putUiStateKey: async () => null,
      deleteUiStateKey: async () => null,
      apiRequest: async () => ({ status: 200, body: { ok: true } }),
      clipboardWriteText: async () => null,
      setZoomLevel: () => {},
      getZoomLevel: () => 1
    }

    const a = render(<AnnotationOverlayApp />)
    await waitFor(() => {
      expect(putCalls.some((c) => c.key === 'annotation-notes-whiteboard')).toBe(true)
    })
    a.unmount()

    putCalls.length = 0

    window.lanstart = {
      ...window.lanstart,
      getUiState: async () => ({
        mode: 'toolbar',
        tool: 'pen',
        penType: 'writing',
        penColor: '#333333',
        penThickness: 6,
        eraserType: 'pixel',
        eraserThickness: 18
      })
    }

    const b = render(<AnnotationOverlayApp />)
    await waitFor(() => {
      expect(putCalls.some((c) => c.key === 'annotation-notes-toolbar')).toBe(true)
    })
    b.unmount()

    putCalls.length = 0

    window.lanstart = {
      ...window.lanstart,
      getUiState: async () => ({
        mode: 'video-show',
        tool: 'pen',
        penType: 'writing',
        penColor: '#333333',
        penThickness: 6,
        eraserType: 'pixel',
        eraserThickness: 18
      })
    }

    const c = render(<AnnotationOverlayApp />)
    await waitFor(() => {
      expect(putCalls.some((c) => c.key === 'annotation-notes-video-show')).toBe(true)
    })
    c.unmount()
  }, 20000)

  it('rotates notes on startup and keeps only last history', async () => {
    vi.resetModules()
    ;(globalThis as any).CanvasRenderingContext2D ??= function CanvasRenderingContext2D() {}
    ;(globalThis as any).Path2D ??= function Path2D() {}
    ;(globalThis as any).PointerEvent ??= class PointerEvent extends MouseEvent {}
    ;(globalThis as any).DragEvent ??= class DragEvent extends MouseEvent {}
    ;(globalThis as any).ResizeObserver ??= class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    if (typeof HTMLCanvasElement !== 'undefined') {
      const noop = () => {}
      const ctx = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'canvas') return document.createElement('canvas')
            if (prop === 'measureText') return () => ({ width: 0 })
            if (prop === 'getLineDash') return () => []
            if (prop === 'getImageData')
              return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })
            if (prop === 'createImageData')
              return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })
            if (prop === 'isPointInPath') return () => false
            return noop
          },
          set: (target, prop, value) => {
            ;(target as any)[prop] = value
            return true
          },
        },
      ) as unknown as CanvasRenderingContext2D

      const originalGetContext = (HTMLCanvasElement.prototype as any).getContext
      ;(HTMLCanvasElement.prototype as any).getContext = function getContext(type: string) {
        if (type === '2d') return ctx
        return originalGetContext?.call(this, type) ?? ctx
      }
    }

    const { AnnotationOverlayApp } = await import('../leaferjs')

    const putCalls: Array<{ key: string; value: unknown }> = []
    const oldDoc = {
      version: 1,
      nodes: [
        {
          role: 'stroke',
          strokeWidth: 6,
          points: [0, 0, 1, 1],
          color: '#000000',
          opacity: 1
        }
      ]
    } as const

    window.lanstart = {
      postCommand: async () => null,
      getEvents: async () => ({ items: [], latest: 0 }),
      getKv: async (key: string) => {
        if (key === 'leafer-settings') return SVG_LEAFER_SETTINGS as any
        if (key === 'annotation-notes-whiteboard') return oldDoc as any
        throw new Error('kv_not_found')
      },
      putKv: async (key: string, value: unknown) => {
        putCalls.push({ key, value })
        return null
      },
      getUiState: async () => ({
        mode: 'whiteboard',
        tool: 'pen',
        penType: 'writing',
        penColor: '#333333',
        penThickness: 6,
        eraserType: 'pixel',
        eraserThickness: 18
      }),
      putUiStateKey: async () => null,
      deleteUiStateKey: async () => null,
      apiRequest: async () => ({ status: 200, body: { ok: true } }),
      clipboardWriteText: async () => null,
      setZoomLevel: () => {},
      getZoomLevel: () => 1
    }

    const a = render(<AnnotationOverlayApp />)
    await waitFor(() => {
      expect(putCalls.some((c) => c.key === 'annotation-notes-whiteboard-prev')).toBe(true)
    })
    a.unmount()

    const prevCall = putCalls.find((c) => c.key === 'annotation-notes-whiteboard-prev')
    expect(prevCall?.value).toEqual({ version: 2, currentPage: 0, pages: [oldDoc] })

    const currentCalls = putCalls.filter((c) => c.key === 'annotation-notes-whiteboard')
    const lastCurrent = currentCalls[currentCalls.length - 1]?.value as any
    expect(lastCurrent?.version).toBe(2)
    expect(lastCurrent?.currentPage).toBe(0)
    expect(lastCurrent?.pages?.[0]?.version).toBe(1)
    expect(lastCurrent?.pages?.[0]?.nodes).toEqual([])
  })
})
