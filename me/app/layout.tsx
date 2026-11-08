import { Google_Sans } from 'next/font/google'
import './globals.css'
const sans = Google_Sans({ subsets: ['latin'], variable: '--font-sans' })
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={sans.variable}><body>{children}</body></html>
}
