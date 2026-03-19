import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "./components/Toast";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
}
