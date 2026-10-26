import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/styles/app.css'
import { App } from './ui/App'
import { installViewport } from './ui/viewport'

installViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
