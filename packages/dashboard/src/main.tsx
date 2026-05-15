import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Conductor] React error:', error, info)
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#0f1117', color: '#f87171', minHeight: '100vh' }}>
          <h2 style={{ color: '#f87171' }}>Dashboard startup error</h2>
          <p style={{ color: '#fca5a5' }}>{err.message}</p>
          <pre style={{ fontSize: '0.75rem', color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {err.stack}
          </pre>
          <p style={{ color: '#6b7280', marginTop: '1rem' }}>
            Check the browser console for details. If this is a wallet extension issue, try refreshing.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
