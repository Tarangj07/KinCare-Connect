import type { Metadata, Viewport } from 'next';
import type { ReactElement, ReactNode } from 'react';

import { AppProviders } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'Elderly Care Coordination',
  description:
    'A secure family and caregiver coordination platform for elderly relatives. Phase 1 — foundation.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0F4C81',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactElement {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
