import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.tsx";
import { AppErrorBoundary } from "./app/AppErrorBoundary.tsx";
import { I18nProvider } from "./i18n/i18n.tsx";
import "./styles.css";
import { ToastProvider } from "./app/CommercialUI.tsx";
import { DownloadTray } from "./app/DownloadTray.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("ROOT_ELEMENT_NOT_FOUND");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <App />
              <DownloadTray />
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
