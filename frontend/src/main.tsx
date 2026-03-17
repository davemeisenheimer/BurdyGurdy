import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { db } from './lib/db';

// Developer utility — run in browser console: __bg_clearAll()
(window as unknown as Record<string, unknown>).__bg_clearAll = async () => {
  await Promise.all([
    db.progress.clear(),
    db.regionSpecies.clear(),
    db.blockedPhotos.clear(),
  ]);
  localStorage.removeItem('birdygurdy_settings');
  console.log('BirdyGurdy: all client-side data cleared. Reload the page.');
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
