import React from 'react';
import ReactDOM from 'react-dom/client';

import { ErrorBoundary } from '../../src/shared/ErrorBoundary';
import App from './App.tsx';

import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary surface="side panel">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
