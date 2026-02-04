import React from 'react'
import { motion } from '../../Framer_Motion'
import type { SettingsTab, SettingsTabItem } from '../types'
import './SettingsSidebar.css'

// Fluent 风格图标
const TabIcons: Record<SettingsTab, React.ReactNode> = {
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
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <span className="settingsSidebarTitle">设置</span>
        </motion.div>
      </div>

      {/* 选项卡列表 */}
      <nav className="settingsSidebarNav">
        {tabs.map((tab, index) => (
          <motion.button
            key={tab.id}
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
            
            {/* 选中指示器 */}
            {activeTab === tab.id && (
              <motion.div
                className="settingsSidebarTabIndicator"
                layoutId="activeTabIndicator"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </motion.button>
        ))}
      </nav>

      {/* 底部信息 */}
      <div className="settingsSidebarFooter">
        <span className="settingsSidebarVersion">LanStartWrite v0.0.0</span>
      </div>
    </div>
  )
}
