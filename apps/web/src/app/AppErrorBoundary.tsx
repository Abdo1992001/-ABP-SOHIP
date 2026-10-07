import { Component, type ErrorInfo, type ReactNode } from "react";

/** The stored locale, read defensively — storage can throw or be empty. */
function readLocale(): "en" | "ar" {
  try {
    return window.localStorage.getItem("abp.locale") === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    window.dispatchEvent(
      new CustomEvent("abp-ui-error", {
        detail: { name: error.name, componentStack: info.componentStack },
      }),
    );
  }
  render() {
    if (this.state.failed) {
      // This is the one screen that cannot use the locale hook: it renders
      // precisely when the tree below it has thrown, and the provider may be
      // part of what failed. It reads the same stored preference the provider
      // reads, so an Arabic session does not suddenly get an English wall.
      const arabic = readLocale() === "ar";
      return (
        <main className="app-state denied" role="alert">
          <div>
            <h1>
              {arabic
                ? "الشاشة دي مش قادرة تفتح"
                : "This screen could not open"}
            </h1>
            <p>
              {arabic
                ? "باقي النظام شغال عادي. حدّث الصفحة عشان تجرب تاني."
                : "The rest of the system is unaffected. Reload to try again."}
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              {arabic ? "حدّث الصفحة" : "Reload"}
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
