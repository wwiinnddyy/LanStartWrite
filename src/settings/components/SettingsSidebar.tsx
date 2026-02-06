import React from 'react'
import { motion } from '../../Framer_Motion'
import type { SettingsTab, SettingsTabItem } from '../types'
import { MotionButton } from '../../button'
import './SettingsSidebar.css'

// Fluent 风格图标
const TabIcons: Record<SettingsTab, React.ReactNode> = {
  appearance: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2" />
      <path d="M12 21v2" />
      <path d="M4.22 4.22l1.42 1.42" />
      <path d="M18.36 18.36l1.42 1.42" />
      <path d="M1 12h2" />
      <path d="M21 12h2" />
      <path d="M4.22 19.78l1.42-1.42" />
      <path d="M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  toolbar: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      <circle cx="12" cy="7" r="1.5" fill="currentColor" />
      <circle cx="17" cy="7" r="1.5" fill="currentColor" />
    </svg>
  ),
  'feature-panel': (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  annotation: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    </svg>
  ),
  'lanstart-bar': (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="14" />
      <line x1="10" y1="10" x2="10" y2="14" />
      <line x1="14" y1="10" x2="14" y2="14" />
      <line x1="18" y1="10" x2="18" y2="14" />
    </svg>
  ),
  about: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

const tabs: SettingsTabItem[] = [
  { id: 'appearance', label: '外观', icon: TabIcons.appearance },
  { id: 'toolbar', label: '浮动工具栏', icon: TabIcons.toolbar },
  { id: 'feature-panel', label: '功能面板', icon: TabIcons['feature-panel'] },
  { id: 'annotation', label: '批注系统', icon: TabIcons.annotation },
  { id: 'lanstart-bar', label: 'LanStartBar', icon: TabIcons['lanstart-bar'] },
  { id: 'about', label: '关于', icon: TabIcons.about },
]

interface SettingsSidebarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  return (
    <div className="settingsSidebar">
      {/* 标题区域 - 澎湃OS风格 */}
      <div className="settingsSidebarHeader">
        <motion.div
          className="settingsSidebarLogo"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="settingsSidebarLogoIcon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 20 20">
              <path fill="currentColor" d="M1.911 7.383a8.5 8.5 0 0 1 1.78-3.08a.5.5 0 0 1 .54-.135l1.918.686a1 1 0 0 0 1.32-.762l.366-2.006a.5.5 0 0 1 .388-.4a8.5 8.5 0 0 1 3.554 0a.5.5 0 0 1 .388.4l.366 2.006a1 1 0 0 0 1.32.762l1.919-.686a.5.5 0 0 1 .54.136a8.5 8.5 0 0 1 1.78 3.079a.5.5 0 0 1-.153.535l-1.555 1.32a1 1 0 0 0 0 1.524l1.555 1.32a.5.5 0 0 1 .152.535a8.5 8.5 0 0 1-1.78 3.08a.5.5 0 0 1-.54.135l-1.918-.686a1 1 0 0 0-1.32.762l-.366 2.007a.5.5 0 0 1-.388.399a8.5 8.5 0 0 1-3.554 0a.5.5 0 0 1-.388-.4l-.366-2.006a1 1 0 0 0-1.32-.762l-1.918.686a.5.5 0 0 1-.54-.136a8.5 8.5 0 0 1-1.78-3.079a.5.5 0 0 1 .152-.535l1.555-1.32a1 1 0 0 0 0-1.524l-1.555-1.32a.5.5 0 0 1-.152-.535m1.06-.006l1.294 1.098a2 2 0 0 1 0 3.05l-1.293 1.098c.292.782.713 1.51 1.244 2.152l1.596-.57q.155-.055.315-.085a2 2 0 0 1 2.326 1.609l.304 1.669a7.6 7.6 0 0 0 2.486 0l.304-1.67a1.998 1.998 0 0 1 2.641-1.524l1.596.571a7.5 7.5 0 0 0 1.245-2.152l-1.294-1.098a1.998 1.998 0 0 1 0-3.05l1.294-1.098a7.5 7.5 0 0 0-1.245-2.152l-1.596.57a2 2 0 0 1-2.64-1.524l-.305-1.669a7.6 7.6 0 0 0-2.486 0l-.304 1.669a2 2 0 0 1-2.64 1.525l-1.597-.571a7.5 7.5 0 0 0-1.244 2.152M7.502 10a2.5 2.5 0 1 1 5 0a2.5 2.5 0 0 1-5 0m1 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 0 0-3 0"/>
            </svg>
          </div>
          <span className="settingsSidebarTitle">设置</span>
        </motion.div>
      </div>

      {/* 选项卡列表 */}
      <nav className="settingsSidebarNav">
        {tabs.map((tab, index) => (
          <MotionButton
            key={tab.id}
            kind="custom"
            ariaLabel={tab.label}
            className={`settingsSidebarTab ${activeTab === tab.id ? 'settingsSidebarTab--active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2, delay: index * 0.05 }}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="settingsSidebarTabIcon">{tab.icon}</span>
            <span className="settingsSidebarTabLabel">{tab.label}</span>
          </MotionButton>
        ))}
      </nav>

      {/* 底部信息 */}
      <div className="settingsSidebarFooter">
        <span className="settingsSidebarVersion">LanStartWrite v0.0.0</span>
      </div>
    </div>
  )
}
