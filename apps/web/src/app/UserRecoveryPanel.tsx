import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest } from "./commercial-api.ts";
import { ErrorBanner, SlideOver, useToast } from "./CommercialUI.tsx";

/**
 * Getting a locked-out colleague back to work.
 *
 * Both of these endpoints have existed the whole time with nothing calling
 * them, which left the app with no answer to the two most ordinary support
 * questions there are: "I forgot my password" and "I lost the phone with my
 * authenticator on it". The only route back was a SQL prompt.
 *
 * `POST /admin/users/{id}/reset-password` also clears `failedLoginCount` and
 * `lockedUntil`, so it is the unlock as well as the reset, and both endpoints
 * revoke the person's live sessions and write an audit row.
 */

/**
 * The administrator never chooses the password.
 *
 * The endpoint takes one rather than minting it, so it is generated here from
 * `crypto.getRandomValues`, shown once to be read out, and paired with
 * `mustChangePassword` so it stops working the moment they sign in. An admin
 * who invents a password tends to invent a memorable one, and a memorable one
 * they have also seen is a password two people know indefinitely.
 */
function generatePassword(): string {
  // No look-alike glyphs: this gets read down a phone line.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

export function UserRecoveryPanel({
  client,
  user,
  onClose,
}: {
  client: ApiClient;
  user: { userId: string; displayName: string; email: string };
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();

  const [issued, setIssued] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"password" | "mfa" | null>(null);

  const refresh = () => cache.invalidateQueries({ queryKey: ["admin-users"] });

  const resetPassword = useMutation({
    mutationFn: async () => {
      const password = generatePassword();
      await commercialRequest(
        client,
        "POST",
        "/admin/users/{userId}/reset-password",
        {
          path: { userId: user.userId },
          body: { password, mustChangePassword: true, revokeSessions: true },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return password;
    },
    onSuccess: async (password) => {
      setIssued(password);
      setConfirming(null);
      await refresh();
    },
  });

  const resetMfa = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/admin/users/{userId}/reset-mfa", {
        path: { userId: user.userId },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setConfirming(null);
      await refresh();
      toast.success(
        txt(
          "Two-step verification cleared. They can enrol again.",
          "تم مسح التحقق بخطوتين. يقدر يسجّله تاني.",
        ),
      );
    },
  });

  return (
    <SlideOver
      title={txt("Account recovery", "استعادة الحساب")}
      onClose={onClose}
    >
      <p className="settings-hint">
        <strong>{user.displayName}</strong> · {user.email}
      </p>

      {/* Shown once. The server stores only the hash, so there is no screen
          that can show it again — and saying so is what stops it being
          dismissed and then asked for. */}
      {issued !== null ? (
        <div className="mfa-recovery">
          <h4>{txt("Temporary password", "كلمة مرور مؤقتة")}</h4>
          <p>
            {txt(
              "Read this to them now. It is not shown again, and it stops working once they sign in and set their own.",
              "اقراهالهم دلوقتي. مش هتظهر تاني، وبتبطل أول ما يدخلوا ويحطوا واحدة بتاعتهم.",
            )}
          </p>
          <ul>
            <li>{issued}</li>
          </ul>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setIssued(null);
              onClose();
            }}
          >
            {txt("Done", "تمام")}
          </button>
        </div>
      ) : (
        <>
          <ErrorBanner
            error={resetPassword.error ?? resetMfa.error}
            retry={() => {
              resetPassword.reset();
              resetMfa.reset();
            }}
          />

          <h3>{txt("Password", "كلمة المرور")}</h3>
          <p className="settings-hint">
            {txt(
              "Issues a one-time password, unlocks the account, and signs them out everywhere.",
              "بتصدر كلمة مرور لمرة واحدة، بتفك قفل الحساب، وبتخرجهم من كل الأجهزة.",
            )}
          </p>
          {confirming === "password" ? (
            <div className="approval-actions">
              <button
                type="button"
                className="danger"
                disabled={resetPassword.isPending}
                onClick={() => {
                  resetPassword.mutate();
                }}
              >
                {resetPassword.isPending
                  ? txt("Resetting…", "جارٍ إعادة التعيين…")
                  : txt("Yes, reset it", "أيوه، أعد التعيين")}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setConfirming(null);
                }}
              >
                {txt("Cancel", "إلغاء")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirming("password");
              }}
            >
              {txt("Reset password", "إعادة تعيين كلمة المرور")}
            </button>
          )}

          <h3>{txt("Two-step verification", "التحقق بخطوتين")}</h3>
          <p className="settings-hint">
            {txt(
              "Use when they have lost the device with their authenticator. They set it up again at their next sign-in.",
              "استخدمها لما يضيع منهم الجهاز اللي عليه تطبيق المصادقة. هيسجّلوه تاني أول دخول.",
            )}
          </p>
          {confirming === "mfa" ? (
            <div className="approval-actions">
              <button
                type="button"
                className="danger"
                disabled={resetMfa.isPending}
                onClick={() => {
                  resetMfa.mutate();
                }}
              >
                {resetMfa.isPending
                  ? txt("Clearing…", "جارٍ المسح…")
                  : txt("Yes, clear it", "أيوه، امسحه")}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setConfirming(null);
                }}
              >
                {txt("Cancel", "إلغاء")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirming("mfa");
              }}
            >
              {txt("Reset two-step verification", "إعادة تعيين التحقق بخطوتين")}
            </button>
          )}
        </>
      )}
    </SlideOver>
  );
}
