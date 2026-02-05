import React from 'react'
import { motion } from '../../Framer_Motion'
import { postCommand } from '../../toolbar/hooks/useBackend'
import './WindowControls.css'

export function WindowControls() {
  const handleMinimize = () => {
    console.log('[WindowControls] Minimize clicked')
    postCommand('app.minimizeSettingsWindow').catch((e) => {
      console.error('[WindowControls] Minimize failed:', e)
    })
  }

  const handleClose = () => {
    console.log('[WindowControls] Close clicked')
    postCommand('app.closeSettingsWindow').catch((e) => {
      console.error('[WindowControls] Close failed:', e)
    })
  }

  return (
    <div className="windowControls">
      <motion.button
        className="windowControlButton windowControlButton--minimize"
        onClick={handleMinimize}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="最小化"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="12" x2="20" y2="12" />
        </svg>
      </motion.button>

      <motion.button
        className="windowControlButton windowControlButton--close"
        onClick={handleClose}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="关闭"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="4" x2="20" y2="20" />
          <line x1="20" y1="4" x2="4" y2="20" />
        </svg>
      </motion.button>
    </div>
  )
}
