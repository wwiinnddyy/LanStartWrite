import React from 'react'
import './styles/button.css'

export type ButtonVariant = 'default' | 'danger' | 'light'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  onClick?: () => void
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>
  onPointerUp?: React.PointerEventHandler<HTMLButtonElement>
  onPointerCancel?: React.PointerEventHandler<HTMLButtonElement>
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>
  children: React.ReactNode
  ariaLabel?: string
  title?: string
  className?: string
  type?: 'button' | 'submit' | 'reset'
  appRegion?: 'drag' | 'no-drag'
  showInToolbar?: boolean
  showInFeaturePanel?: boolean
  style?: React.CSSProperties
}

export function Button({
  variant = 'default',
  size = 'sm',
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  children,
  ariaLabel,
  title,
  className,
  type = 'button',
  appRegion = 'no-drag',
  showInToolbar,
  showInFeaturePanel,
  style
}: ButtonProps) {
  const classes = [
    'lsButton',
    variant === 'danger' ? 'lsButton--danger' : null,
    variant === 'light' ? 'lsButton--light' : null,
    size === 'md' ? 'lsButton--md' : 'lsButton--sm',
    appRegion === 'drag' ? 'lsButton--drag' : null,
    className ?? null
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      data-show-in-toolbar={showInToolbar === undefined ? undefined : String(showInToolbar)}
      data-show-in-feature-panel={showInFeaturePanel === undefined ? undefined : String(showInFeaturePanel)}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      title={title}
      type={type}
      style={style}
    >
      {children}
    </button>
  )
}
