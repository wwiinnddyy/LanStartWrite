import { useEffect } from 'react'
import { postCommand } from './useBackend'

export function useZoomOnWheel() {
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey && window.lanstart) {
        e.preventDefault()
        const currentZoom = window.lanstart.getZoomLevel()
        // 向上滚动 (deltaY < 0) -> 放大
        // 向下滚动 (deltaY > 0) -> 缩小
        const delta = e.deltaY > 0 ? -0.5 : 0.5
        
        // 限制缩放范围，防止过大或过小导致界面不可用
        // Electron 默认缩放是 0 (100%)
        // 范围 -3 (约 50%) 到 5 (约 300%+) 应该足够
        const nextZoom = Math.min(Math.max(currentZoom + delta, -3), 5)
        
        // 乐观更新本地缩放以确保流畅
        window.lanstart.setZoomLevel(nextZoom)
        // 发送命令通知后端同步其他窗口
        void postCommand('win.setUiZoom', { zoom: nextZoom })
      }
    }

    // passive: false 是必须的，因为我们要调用 preventDefault
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])
}
