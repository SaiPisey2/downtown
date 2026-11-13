import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startLoop } from './game/loop';
import { installTestHook } from './game/testHook';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

installTestHook();
startLoop();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
