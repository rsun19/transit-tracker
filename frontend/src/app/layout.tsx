import type { Metadata } from 'next';
import { Providers } from '@/lib/providers';

export const metadata: Metadata = {
  title: 'Transit Tracker',
  description: 'Real-time transit tracking powered by GTFS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
