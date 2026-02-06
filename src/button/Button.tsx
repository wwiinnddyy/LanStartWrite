import React from 'react'
import type { HTMLMotionProps } from 'framer-motion'
import { motion } from '../Framer_Motion'
import './styles/button.css'

export type ButtonVariant = 'default' | 'danger' | 'light'
export type ButtonSize = 'sm' | 'md'
export type ButtonKind = 'icon' | 'text' | 'custom'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  kind?: ButtonKind
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

export type MotionButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  kind?: ButtonKind
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
} & Omit<
  HTMLMotionProps<'button'>,
  | 'aria-label'
  | 'children'
  | 'className'
  | 'disabled'
  | 'onClick'
  | 'onPointerCancel'
  | 'onPointerDown'
  | 'onPointerLeave'
  | 'onPointerUp'
  | 'style'
  | 'title'
  | 'type'
>

function buildButtonClasses({
  variant,
  size,
  kind,
  appRegion,
  className
}: {
  variant: ButtonVariant
  size: ButtonSize
  kind: ButtonKind
  appRegion: 'drag' | 'no-drag'
  className?: string
}) {
  return [
    'lsButton',
    kind === 'text' ? 'lsButton--text' : kind === 'custom' ? 'lsButton--custom' : 'lsButton--icon',
    variant === 'danger' ? 'lsButton--danger' : null,
    variant === 'light' ? 'lsButton--light' : null,
    size === 'md' ? 'lsButton--md' : 'lsButton--sm',
    appRegion === 'drag' ? 'lsButton--drag' : null,
    className ?? null
  ]
    .filter(Boolean)
    .join(' ')
}

export function Button({
  variant = 'default',
  size = 'sm',
  kind = 'icon',
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
  const classes = buildButtonClasses({ variant, size, kind, appRegion, className })

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

export function MotionButton({
  variant = 'default',
  size = 'sm',
  kind = 'custom',
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
  style,
  ...rest
}: MotionButtonProps) {
  const classes = buildButtonClasses({ variant, size, kind, appRegion, className })

  return (
    <motion.button
      {...rest}
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
    </motion.button>
  )
}
