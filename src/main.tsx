import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { useAuthStore } from './store/authStore';
import { Toaster } from 'react-hot-toast';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

const root = createRoot(rootElement);

// Render immediately
root.render(
  <StrictMode>
    <Toaster 
      position="top-right"
      toastOptions={{
        // Only show success and error toasts
        success: {
          duration: 3000,
          style: {
            background: '#10B981',
            color: 'white',
          },
        },
        error: {
          duration: 4000,
          style: {
            background: '#EF4444',
            color: 'white',
          },
        },
      }}
    />
    <App />
  </StrictMode>
);