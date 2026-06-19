// src/main.js (frontend entry)
import '../style/main.css';
import { initUI } from './ui.js';

function initGuideTabs() {
  const tabs = Array.from(document.querySelectorAll('.guide-tab'));
  const panels = Array.from(document.querySelectorAll('.guide-tab-panel'));
  if (!tabs.length || !panels.length) return;

  const activate = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initUI();
  initGuideTabs();
});
