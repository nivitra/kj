'use client';
import './globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      // Don't hammer the API when rate-limited (429) or offline
      retry: (failureCount, error: any) => {
        const status = error?.response?.status;
        if (status === 429 || status === 401 || status === 403) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>SJ Clicks and Films · Admin</title>
        <link rel="icon" href="/logo-square.png" type="image/png" />
      </head>
      <body className={inter.className}>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: '#FFFFFF',
                color: '#1A1917',
                border: '1px solid #EAE6DE',
                borderRadius: '12px',
                fontSize: '14px',
                boxShadow: '0 10px 30px -12px rgba(26,25,23,0.25)',
              },
              success: { iconTheme: { primary: '#3F8F5B', secondary: '#fff' } },
              error: { iconTheme: { primary: '#C4413A', secondary: '#fff' } },
            }}
          />
        </QueryClientProvider>
      </body>
    </html>
  );
}
