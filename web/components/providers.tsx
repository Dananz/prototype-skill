'use client'
// What every page of /me sits in: TanStack Query (the links' cache, seeded by the server), the CSP
// nonce for the libraries that add a <style> of their own (Base UI; and Vaul's scroll lock, through
// get-nonce, which react-style-singleton reads), and the toasts.
import { useState, type ReactNode } from 'react'
import { setNonce } from 'get-nonce'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CSPProvider } from '@base-ui/react/csp-provider'
import { Toaster } from 'sonner'
import { useMounted } from '@/lib/media'

export function Providers({ nonce, children }: { nonce: string; children: ReactNode }) {
  if (typeof window !== 'undefined') setNonce(nonce)
  // The server's answer is fresh for 30 s; after that a refocus fetches it again, in the background.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }))
  // The toaster only in the browser: it draws with inline styles, which the CSP refuses in HTML.
  const mounted = useMounted()
  return (
    <QueryClientProvider client={client}>
      <CSPProvider nonce={nonce}>
        {children}
        {mounted && <Toaster position="bottom-center" toastOptions={{ className: 'font-sans' }} />}
      </CSPProvider>
    </QueryClientProvider>
  )
}
