import React from 'react'
import { motion } from '../../Framer_Motion'
import type { SettingsTab } from '../types'
import './SettingsContent.css'

interface SettingsContentProps {
  activeTab: SettingsTab
}

// 各选项卡的内容占位组件
function ToolbarSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">浮动工具栏</h2>
      <p className="settingsContentDescription">配置浮动工具栏的外观和行为</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <circle cx="7" cy="7" r="1.5" fill="currentColor" />
            <circle cx="12" cy="7" r="1.5" fill="currentColor" />
            <circle cx="17" cy="7" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">浮动工具栏设置即将推出</p>
      </div>
    </div>
  )
}

function FeaturePanelSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">功能面板</h2>
      <p className="settingsContentDescription">管理功能面板的显示选项</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">功能面板设置即将推出</p>
      </div>
    </div>
  )
}

function AnnotationSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">批注系统</h2>
      <p className="settingsContentDescription">配置批注工具和笔刷设置</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">批注系统设置即将推出</p>
      </div>
    </div>
  )
}

function LanStartBarSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">LanStartBar</h2>
      <p className="settingsContentDescription">配置 LanStartBar 的显示和行为</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <line x1="6" y1="10" x2="6" y2="14" />
            <line x1="10" y1="10" x2="10" y2="14" />
            <line x1="14" y1="10" x2="14" y2="14" />
            <line x1="18" y1="10" x2="18" y2="14" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">LanStartBar 设置即将推出</p>
      </div>
    </div>
  )
}

function AboutSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">关于</h2>
      <p className="settingsContentDescription">应用信息和版本详情</p>
      
      <div className="settingsAboutCard">
        <div className="settingsAboutLogo">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5">
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
        <h3 className="settingsAboutAppName">LanStartWrite</h3>
        <p className="settingsAboutVersion">版本 0.0.0</p>
        <p className="settingsAboutDescription">
          一款现代化的屏幕批注和演示工具，
          <br />
          帮助您更高效地进行屏幕标注和演示。
        </p>
        
        <div className="settingsAboutLinks">
          <a href="#" className="settingsAboutLink">官方网站</a>
          <a href="#" className="settingsAboutLink">GitHub</a>
          <a href="#" className="settingsAboutLink">反馈问题</a>
        </div>
      </div>
      
      <div className="settingsAboutCredits">
        <h4 className="settingsAboutCreditsTitle">技术栈</h4>
        <div className="settingsAboutCreditsList">
          <span className="settingsAboutCredit">Electron</span>
          <span className="settingsAboutCredit">React</span>
          <span className="settingsAboutCredit">TypeScript</span>
          <span className="settingsAboutCredit">Framer Motion</span>
        </div>
      </div>
    </div>
  )
}

const contentComponents: Record<SettingsTab, React.FC> = {
  toolbar: ToolbarSettings,
  'feature-panel': FeaturePanelSettings,
  annotation: AnnotationSettings,
  'lanstart-bar': LanStartBarSettings,
  about: AboutSettings,
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  const ContentComponent = contentComponents[activeTab]
  
  return (
    <div className="settingsContent">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="settingsContentInner"
      >
        <ContentComponent />
      </motion.div>
    </div>
  )
}
