import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { ControllerApp } from './ControllerApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ControllerApp />
  </StrictMode>,
)
