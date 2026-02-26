import React, { useState } from 'react'
import { motion, useReducedMotion } from '../../Framer_Motion'
import { SettingsSidebar } from '../../settings/components/SettingsSidebar'
import { SettingsContent } from '../../settings/components/SettingsContent'
import { postCommand } from '../../status'
import type { SettingsTab } from '../../settings/types'
import './web-settings-page.css'

function BackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M11.8 4.4L6.2 10l5.6 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function WebSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="webSettingsPageRoot"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={reduceMotion ? undefined : { opacity: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="webSettingsPageHeader">
        <button
          type="button"
          className="webSettingsBackButton"
          onClick={() => {
            postCommand('app.closeSettingsWindow').catch(() => undefined)
          }}
        >
          <BackIcon />
          <span>返回</span>
        </button>
      </header>

      <main className="webSettingsPageLayout">
        <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <SettingsContent activeTab={activeTab} />
      </main>
    </motion.div>
  )
}
