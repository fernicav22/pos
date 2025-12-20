import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Toaster } from 'react-hot-toast';

// Start auth initialization immediately before rendering
// This gives it a head start while React is mounting
import { useAuthStore } from './store/authStore';
useAuthStore.getState().initializeAuth().catch(error => {
  console.error('Failed to initialize auth:', error);
});

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