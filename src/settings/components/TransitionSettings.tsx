import React from 'react'
import { motion } from '../../Framer_Motion'
import type { Easing } from 'framer-motion'
import { MotionButton } from '../../button'
import './TransitionSettings.css'

export type TransitionPreset = {
  name: string
  value: string
  duration: number
  easing: string
  description: string
}

function toMotionEase(easing: string): Easing {
  const m = easing.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i)
  if (!m) return [0.4, 0, 0.2, 1]
  const a = Number(m[1])
  const b = Number(m[2])
  const c = Number(m[3])
  const d = Number(m[4])
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return [0.4, 0, 0.2, 1]
  return [a, b, c, d]
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  {
    name: '流畅',
    value: 'smooth',
    duration: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    description: '标准流畅过渡',
  },
  {
    name: '快速',
    value: 'fast',
    duration: 150,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    description: '快速响应过渡',
  },
  {
    name: '柔和',
    value: 'soft',
    duration: 450,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    description: '柔和缓慢过渡',
  },
  {
    name: '弹性',
    value: 'bouncy',
    duration: 400,
    easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    description: '弹性回弹效果',
  },
  {
    name: '急速',
    value: 'snappy',
    duration: 100,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    description: '极速无感过渡',
  },
]

export type BackgroundTransition = {
  name: string
  value: string
  duration: number
  blur: number
  description: string
}

export const BACKGROUND_TRANSITIONS: BackgroundTransition[] = [
  {
    name: '标准',
    value: 'normal',
    duration: 200,
    blur: 48,
    description: '标准背景过渡',
  },
  {
    name: '快速',
    value: 'fast',
    duration: 100,
    blur: 32,
    description: '快速背景切换',
  },
  {
    name: '柔和',
    value: 'soft',
    duration: 400,
    blur: 64,
    description: '柔和模糊过渡',
  },
  {
    name: '无动画',
    value: 'none',
    duration: 0,
    blur: 48,
    description: '立即切换无过渡',
  },
]

interface TransitionSettingsProps {
  transitionPreset: string
  onTransitionChange: (preset: TransitionPreset) => void
  backgroundTransition: string
  onBackgroundTransitionChange: (transition: BackgroundTransition) => void
}

export function TransitionSettings({
  transitionPreset,
  onTransitionChange,
  backgroundTransition,
  onBackgroundTransitionChange,
}: TransitionSettingsProps) {
  return (
    <div className="transitionSettings">
      {/* 界面过渡动画设置 */}
      <div className="transitionSettingsSection">
        <h3 className="transitionSettingsSubtitle">界面过渡动画</h3>
        <p className="transitionSettingsDescription">调整界面元素的动画效果</p>
        
        <div className="transitionPresetGrid">
          {TRANSITION_PRESETS.map((preset, index) => (
            <MotionButton
              key={preset.value}
              kind="custom"
              ariaLabel={`过渡预设：${preset.name}`}
              className={`transitionPresetCard ${transitionPreset === preset.value ? 'transitionPresetCard--active' : ''}`}
              onClick={() => onTransitionChange(preset)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="transitionPresetPreview">
                <motion.div
                  className="transitionPresetDemo"
                  animate={
                    transitionPreset === preset.value
                      ? { x: [0, 24, 0] }
                      : { x: 0 }
                  }
                  transition={{
                    duration: preset.duration / 1000,
                    ease: toMotionEase(preset.easing),
                    repeat: transitionPreset === preset.value ? Infinity : 0,
                    repeatDelay: 0.5,
                  }}
                  style={{
                    transition: `all ${preset.duration}ms ${preset.easing}`,
                  }}
                />
              </div>
              <div className="transitionPresetInfo">
                <span className="transitionPresetName">{preset.name}</span>
                <span className="transitionPresetDesc">{preset.description}</span>
              </div>
              {transitionPreset === preset.value && (
                <motion.div
                  className="transitionPresetCheck"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}
            </MotionButton>
          ))}
        </div>
      </div>

      {/* 背景过渡设置 */}
      <div className="transitionSettingsSection">
        <h3 className="transitionSettingsSubtitle">背景过渡效果</h3>
        <p className="transitionSettingsDescription">调整窗口背景的模糊和过渡效果</p>
        
        <div className="backgroundTransitionGrid">
          {BACKGROUND_TRANSITIONS.map((transition, index) => (
            <MotionButton
              key={transition.value}
              kind="custom"
              ariaLabel={`背景过渡：${transition.name}`}
              className={`backgroundTransitionCard ${backgroundTransition === transition.value ? 'backgroundTransitionCard--active' : ''}`}
              onClick={() => onBackgroundTransitionChange(transition)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 + 0.2 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div 
                className="backgroundTransitionPreview"
                style={{
                  backdropFilter: `blur(${transition.blur / 2}px)`,
                }}
              >
                <div className="backgroundTransitionDemo" />
              </div>
              <div className="backgroundTransitionInfo">
                <span className="backgroundTransitionName">{transition.name}</span>
                <span className="backgroundTransitionDesc">{transition.description}</span>
              </div>
              {backgroundTransition === transition.value && (
                <motion.div
                  className="backgroundTransitionCheck"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}
            </MotionButton>
          ))}
        </div>
      </div>
    </div>
  )
}
