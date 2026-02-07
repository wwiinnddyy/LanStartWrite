import React from 'react'
import { MotionButton } from '../../button'
import { postCommand } from '../../toolbar/hooks/useBackend'
import './WindowControls.css'

export function WindowControls(props: { windowId: string; showMaximize?: boolean }) {
  const showMaximize = props.showMaximize !== false

  const handleMinimize = () => {
    postCommand('app.windowControl', { windowId: props.windowId, action: 'minimize' }).catch(() => undefined)
  }

  const handleToggleMaximize = () => {
    postCommand('app.windowControl', { windowId: props.windowId, action: 'toggleMaximize' }).catch(() => undefined)
  }

  const handleClose = () => {
    postCommand('app.windowControl', { windowId: props.windowId, action: 'close' }).catch(() => undefined)
  }

  return (
    <div className="windowControls">
      <MotionButton
        kind="custom"
        ariaLabel="最小化"
        className="windowControlButton windowControlButton--minimize"
        onClick={handleMinimize}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="最小化"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="12" x2="20" y2="12" />
        </svg>
      </MotionButton>

      {showMaximize && (
        <MotionButton
          kind="custom"
          ariaLabel="最大化"
          className="windowControlButton windowControlButton--maximize"
          onClick={handleToggleMaximize}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          title="最大化"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </MotionButton>
      )}

      <MotionButton
        kind="custom"
        ariaLabel="关闭"
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
      </MotionButton>
    </div>
  )
}
