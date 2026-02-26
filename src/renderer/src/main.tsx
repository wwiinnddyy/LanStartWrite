import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LanStartMantineProvider } from '../../Mantine'
import { ensureWebLanstartAdapter } from '../../status/webLanstartAdapter'
import '../../Tailwind/tailwind.css'
import './styles.css'

ensureWebLanstartAdapter()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanStartMantineProvider>
      <App />
    </LanStartMantineProvider>
  </React.StrictMode>
)
