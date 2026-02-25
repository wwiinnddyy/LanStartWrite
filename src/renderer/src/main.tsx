import React from 'react'
import ReactDOM from 'react-dom/client'
import './electrobunBridge'
import App from './App'
import { LanStartMantineProvider } from '../../Mantine'
import '../../Tailwind/tailwind.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanStartMantineProvider>
      <App />
    </LanStartMantineProvider>
  </React.StrictMode>
)
