import "@fontsource-variable/inter";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { startAnalytics } from "./app/analytics";
import { useStore } from "./app/store";
import { topicForPath } from "./app/topics";

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
  }
}
// Injected by Vite (see vite.config.ts); Cesium reads it from the window.
declare const CESIUM_BASE_URL: string;
declare const CESIUM_VERSION: string;
window.CESIUM_BASE_URL = CESIUM_BASE_URL;

// The service worker makes the site installable, keeps the unchanging build and
// globe files cached between visits, and lets the app open offline. Production
// only, so it never interferes with the development server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?cesium=${CESIUM_VERSION}`).catch(() => undefined);
}

startAnalytics();
// A topic page (/wind-map/ and so on) opens with its layer already on.
const topic = topicForPath(window.location.pathname);
if (topic) useStore.getState().set({ introOpen: false, ...topic.preset });

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
