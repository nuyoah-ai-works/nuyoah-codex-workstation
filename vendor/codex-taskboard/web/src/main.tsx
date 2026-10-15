import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "../../../../nuyoah/workstation/interaction-theme.css";
import { createInteractionTheme } from "../../../../nuyoah/workstation/interaction-motion.mjs";
const interactionTheme = createInteractionTheme({ window, frame: true });
if (import.meta.hot) import.meta.hot.dispose(() => interactionTheme.destroy());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
