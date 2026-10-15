import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserClient } from '../../src/platform/ui-client'
import { App } from '../../src/ui/App'
import '../../src/ui/styles/tokens.css'
import '../../src/ui/styles/app.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App client={createBrowserClient()} />
    </StrictMode>,
  )
}
