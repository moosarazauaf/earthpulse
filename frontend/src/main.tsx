import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
  }
}
// Injected by Vite (see vite.config.ts); Cesium reads it from the window.
declare const CESIUM_BASE_URL: string;
window.CESIUM_BASE_URL = CESIUM_BASE_URL;

// Registering a service worker lets browsers offer "Install app". Production
// only, so it never interferes with the development server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
