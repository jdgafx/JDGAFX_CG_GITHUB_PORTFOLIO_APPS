import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// The webfont sheet ships as media="print" so it never blocks first paint; promote it
// here rather than with an inline onload handler, which the CSP would reject.
const fontSheet = document.getElementById('webfonts') as HTMLLinkElement | null
if (fontSheet) fontSheet.media = 'all'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
