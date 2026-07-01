// Self-hosted fonts — bundled into the app at build time, never fetched from a CDN
// at runtime. Static Fontsource packages register the exact family names the
// design system expects ('Space Grotesk', 'Work Sans'); material-symbols registers
// 'Material Symbols Outlined' + the .material-symbols-outlined helper.
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/work-sans/400.css'
import '@fontsource/work-sans/500.css'
import '@fontsource/work-sans/600.css'
import 'material-symbols/outlined.css'

import './assets/tokens.css'
import './assets/main.css'
import './flyout/flyout.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
