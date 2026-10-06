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

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
