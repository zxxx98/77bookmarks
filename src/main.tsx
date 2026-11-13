import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { StrictMode, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SessionGate } from './components/SessionGate'
import { usePrivateGeneration } from './private/use'
import './styles/index.css'

const queryClient = new QueryClient({
  // IndexedDB and extension messages must keep working when navigator.onLine is false.
  defaultOptions: { queries: { staleTime: 30_000, networkMode: 'always' }, mutations: { networkMode: 'always' } },
})

/**
 * Opening or locking a private space swaps the board the whole interface shows. It starts
 * over with nothing cached, so that neither board ever shows a trace of the other.
 */
function Board() {
  const generation = usePrivateGeneration()
  const queryClient = useQueryClient()
  const shown = useRef(generation)
  if (shown.current !== generation) {
    shown.current = generation
    queryClient.clear()
  }
  return <App key={generation} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <Board />
      </SessionGate>
    </QueryClientProvider>
  </StrictMode>,
)
