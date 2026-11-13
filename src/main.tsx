import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startLoop } from './game/loop';
import { installTestHook } from './game/testHook';
import { App, openFromLocation } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

installTestHook();
startLoop();
// before the first render, so the first screen is already the right one
openFromLocation();
window.addEventListener('hashchange', openFromLocation);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
