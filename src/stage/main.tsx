import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { StageApp } from './StageApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StageApp />
  </StrictMode>,
)
