import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { RootErrorBoundary } from "@/components/music/root-error-boundary";
import "./styles.css";

const router = getRouter();

const rootElement = document.getElementById("root");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <RootErrorBoundary>
        <RouterProvider router={router} />
      </RootErrorBoundary>
    </React.StrictMode>,
  );
}

// Resilient PWA Service Worker Registration
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const registerSW = () => {
    try {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Check for worker updates in background
          if (reg && typeof reg.update === "function") {
            reg.update().catch(() => {});
          }
        })
        .catch((error) => {
          console.warn("[MEVO] Service Worker registration bypassed:", error);
        });
    } catch (err) {
      console.warn("[MEVO] Service Worker registration failed silently:", err);
    }
  };

  if (document.readyState === "complete") {
    registerSW();
  } else {
    window.addEventListener("load", registerSW, { once: true });
  }
}

