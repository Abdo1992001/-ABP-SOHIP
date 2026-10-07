import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import {
  createAccount,
  listAccounts,
  listCountries,
} from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";
// AccountPicker is always rendered inside another <form> (opportunity /
// complaint / return / activity create dialogs), so the inline "new company"
// UI below is deliberately NOT a <form> — nested <form> elements are invalid
// HTML and the browser silently submits the wrong (outer) one on click.
export function AccountPicker({
  client,
  value,
  onChange,
}: {
  client: ApiClient;
  value: string;
  onChange: (id: string) => void;
}) {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCountryCode, setNewCountryCode] = useState("");
  const query = useQuery({
    queryKey: ["account-picker", search, page],
    queryFn: () =>
      listAccounts(client, { page, limit: 25, ...(search ? { search } : {}) }),
  });
  const countries = useQuery({
    queryKey: ["countries"],
    queryFn: () => listCountries(client),
    enabled: creating,
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createAccount(client, {
        canonicalName: newName,
        countryCode: newCountryCode,
      }),
    onSuccess: ({ data }) => {
      onChange(data.accountId);
      setCreating(false);
      setNewName("");
      setNewCountryCode("");
      void queryClient.invalidateQueries({ queryKey: ["account-picker"] });
    },
  });
  const selected = query.data?.data.find((a) => a.accountId === value);
  return (
    <fieldset className="account-picker">
      <legend>{locale === "ar" ? "العميل" : "Customer"}</legend>
      {creating ? (
        <div className="account-picker-inline-create">
          <label>
            {locale === "ar" ? "اسم الشركة" : "Company name"}
            <input
              required
              maxLength={300}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
          </label>
          <label>
            {locale === "ar" ? "الدولة" : "Country"}
            <select
              required
              value={newCountryCode}
              onChange={(e) => {
                setNewCountryCode(e.target.value);
              }}
            >
              <option value="">
                {locale === "ar" ? "اختر الدولة" : "Choose country"}
              </option>
              {(countries.data ?? []).map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.displayName}
                </option>
              ))}
            </select>
          </label>
          <ErrorBanner
            error={createMutation.error}
            retry={() => {
              createMutation.mutate();
            }}
          />
          <div className="account-picker-inline-create-actions">
            <button
              type="button"
              className="primary"
              disabled={createMutation.isPending || !newName || !newCountryCode}
              onClick={() => {
                createMutation.mutate();
              }}
            >
              {createMutation.isPending
                ? locale === "ar"
                  ? "جار الإنشاء…"
                  : "Creating…"
                : locale === "ar"
                  ? "إنشاء"
                  : "Create"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setCreating(false);
              }}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            type="search"
            aria-label={locale === "ar" ? "بحث العملاء" : "Search customers"}
            placeholder={locale === "ar" ? "اسم العميل" : "Customer name"}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <ErrorBanner error={query.error} retry={() => void query.refetch()} />
          <select
            required
            aria-label={locale === "ar" ? "اختر العميل" : "Select customer"}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          >
            <option value="">
              {locale === "ar" ? "اختر العميل" : "Select customer"}
            </option>
            {selected &&
              !query.data?.data.some((a) => a.accountId === value) && (
                <option value={selected.accountId}>
                  {selected.canonicalName}
                </option>
              )}
            {query.data?.data.map((a) => (
              <option value={a.accountId} key={a.accountId}>
                {a.canonicalName}
              </option>
            ))}
          </select>
          <div className="account-picker-actions">
            <div className="pagination">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => {
                  setPage(page - 1);
                }}
              >
                {locale === "ar" ? "السابق" : "Previous"}
              </button>
              <span>{page}</span>
              <button
                type="button"
                disabled={!query.data?.meta.hasNext}
                onClick={() => {
                  setPage(page + 1);
                }}
              >
                {locale === "ar" ? "التالي" : "Next"}
              </button>
            </div>
            <button
              type="button"
              className="secondary account-picker-new-btn"
              onClick={() => {
                setCreating(true);
              }}
            >
              {locale === "ar" ? "+ عميل جديد" : "+ New company"}
            </button>
          </div>
          <p className="account-picker-hint">
            {locale === "ar"
              ? 'لو اسم الشركة مش موجود في القايمة، اضغط "+ عميل جديد" لإنشائه، وتقدر تعدّل بياناته بعد كده من صفحة العملاء.'
              : 'If the company isn\'t listed, click "+ New company" to create it — you can edit its details later from the Customers page.'}
          </p>
        </>
      )}
    </fieldset>
  );
}
