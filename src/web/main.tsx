import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

export function mount() {
  createRoot(document.getElementById('root')!).render(<App />);
}

if (!import.meta.env.VITE_DEMO) mount();
