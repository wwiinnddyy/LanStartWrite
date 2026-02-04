export type SettingsTab =
  | 'toolbar'
  | 'feature-panel'
  | 'annotation'
  | 'lanstart-bar'
  | 'about'

export interface SettingsTabItem {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}
