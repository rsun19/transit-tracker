import type { Metadata } from 'next';
import { Providers } from '@/lib/providers';
import { Header } from '@/components/ui/Header';
import 'leaflet/dist/leaflet.css';

export const metadata: Metadata = {
  title: 'Transit Tracker',
  description: 'Real-time transit tracking powered by GTFS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
