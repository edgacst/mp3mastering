// src/main.js (frontend entry)
import '../style/main.css';
import { initUI } from './ui.js';

// DOMContentLoaded 후 UI 초기화
window.addEventListener('DOMContentLoaded', () => {
  initUI();
});
