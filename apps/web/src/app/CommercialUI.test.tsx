import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/i18n.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ErrorBanner", () => {
  it("turns an expired-session key into a useful English message", () => {
    render(
      <I18nProvider>
        <ErrorBanner
          error={new Error("errors.unauthenticated")}
          retry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session has ended. Sign in again to continue.",
    );
  });

  it("localizes the same failure in Arabic", () => {
    window.localStorage.setItem("abp.locale", "ar");
    render(
      <I18nProvider>
        <ErrorBanner
          error={new Error("errors.unauthenticated")}
          retry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "انتهت جلسة الدخول. سجّل الدخول مرة أخرى للمتابعة.",
    );
  });
});
