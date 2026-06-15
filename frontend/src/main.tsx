import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { LandingPage } from './components/screens/LandingPage';
import './index.css';
import { db } from './lib/db';

// Developer utility - run in browser console: __bg_clearAll()
(window as unknown as Record<string, unknown>).__bg_clearAll = async () => {
  await Promise.all([
    db.progress.clear(),
    db.regionSpecies.clear(),
    db.blockedPhotos.clear(),
    db.keyValue.clear(),
  ]);
  console.log('BirdyGurdy: all client-side data cleared. Reload the page.');
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/"     element={<LandingPage />} />
        <Route path="/game" element={<App />} />
        <Route path="*"     element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
