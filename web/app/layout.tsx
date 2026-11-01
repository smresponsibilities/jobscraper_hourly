import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './workspace.css';

export const metadata: Metadata = {
  title: 'Job Radar',
  description: 'Fresher and entry-level roles in India and remote, straight from company ATS boards.',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' }, shortcut: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('jobradar-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}" }} /></head>
      <body>{children}</body>
    </html>
  );
}
