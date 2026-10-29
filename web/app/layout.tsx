import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

export const metadata: Metadata = {
  title: 'Job Radar',
  description: 'Fresher and entry-level roles in India and remote, straight from company ATS boards.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
