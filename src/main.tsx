import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installMock } from './mock';
import '@fontsource-variable/inter';
import './styles.css';

// Mock API is on by default so dist/ works standalone. Build with VITE_MOCK=false for the real backend.
if (import.meta.env.VITE_MOCK !== 'false') installMock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
