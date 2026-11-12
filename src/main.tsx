import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const queryClient = new QueryClient({
  // IndexedDB and extension messages must keep working when navigator.onLine is false.
  defaultOptions: { queries: { staleTime: 30_000, networkMode: 'always' }, mutations: { networkMode: 'always' } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
