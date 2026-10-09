import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// the faces the tokens name, then styles.css before any component: it holds the primitives
// (.btn, .input, .menu…) that component stylesheets override, and Vite emits CSS in import order
import "./fonts/fonts.css";
import "./styles.css";
import { App } from "./App.tsx";
import { SettingsProvider } from "./lib/settings.ts";
import "./lib/viewport.ts";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
