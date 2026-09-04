import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LangGraph Flow Studio',
  description: 'Visual Node Builder and Graph Studio for LangGraph',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
