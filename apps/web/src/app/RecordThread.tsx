import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner, LoadingSkeleton } from "./CommercialUI.tsx";
import { UserAvatar } from "./UserAvatar.tsx";

/**
 * The conversation about one record, shown on that record.
 *
 * Every deal in this business is argued over before it closes — a discount
 * asked for, a delivery date pushed, a spec changed on site. Until now none of
 * that lived in the system: the record kept the final number and the argument
 * that produced it stayed in WhatsApp, on the phone of whoever happened to be
 * handling it. This panel is where that argument goes instead, so the price
 * has a reason attached to it after the person who agreed it has moved on.
 *
 * It is deliberately not a chat app. There is no invite step and no member
 * list to curate: anyone who may open the record may read the thread, and
 * posting is how you join it.
 */

interface ThreadMessage {
  messageId: string;
  senderUserId: string;
  senderName: string;
  senderPhotoUpdatedAt?: string | null;
  body: string;
  createdAt: string;
}

interface Thread {
  conversationId: string | null;
  messages: ThreadMessage[];
}

export function RecordThread({
  client,
  contextType,
  contextId,
  currentUserId,
}: {
  client: ApiClient;
  contextType: "OPPORTUNITY" | "QUOTATION";
  contextId: string;
  currentUserId: string;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const cache = useQueryClient();
  const [draft, setDraft] = useState("");
  const queryKey = ["record-thread", contextType, contextId];

  const thread = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await client.GET(
        "/record-conversations/{contextType}/{contextId}",
        { params: { path: { contextType, contextId }, query: { limit: 100 } } },
      );
      if (!result.data) throw new Error("THREAD_LOAD_FAILED");
      return result.data.data as unknown as Thread;
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const result = await client.POST(
        "/record-conversations/{contextType}/{contextId}/messages",
        {
          params: { path: { contextType, contextId } },
          body: { body: draft.trim() },
        },
      );
      if (!result.data) throw new Error("THREAD_POST_FAILED");
      return result.data;
    },
    onSuccess: async () => {
      setDraft("");
      await cache.invalidateQueries({ queryKey });
    },
  });

  const messages = thread.data?.messages ?? [];

  return (
    <section className="record-thread">
      <header className="record-thread-head">
        <h3>{txt("Discussion", "النقاش")}</h3>
        <p>
          {txt(
            "Why the numbers on this record are what they are. Everyone who can open it can read this.",
            "ليه الأرقام في السجل ده كده. أي حد يقدر يفتح السجل يقدر يقرأ ده.",
          )}
        </p>
      </header>

      {thread.isLoading && <LoadingSkeleton rows={3} />}
      <ErrorBanner error={thread.error} retry={() => void thread.refetch()} />

      {!thread.isLoading && messages.length === 0 && (
        <p className="record-thread-empty">
          {txt(
            "Nothing recorded yet. The first note is usually what the customer asked for.",
            "لسه مفيش حاجة متسجلة. أول ملاحظة غالبًا بتكون العميل طلب إيه.",
          )}
        </p>
      )}

      <ol className="record-thread-list">
        {messages.map((message) => (
          <li
            key={message.messageId}
            className={
              message.senderUserId === currentUserId
                ? "record-thread-item is-mine"
                : "record-thread-item"
            }
          >
            <div className="record-thread-meta">
              <UserAvatar
                userId={message.senderUserId}
                displayName={message.senderName}
                photoUpdatedAt={message.senderPhotoUpdatedAt}
                size="sm"
              />
              <strong>{message.senderName}</strong>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString(
                  locale === "ar" ? "ar-EG" : "en-GB",
                  { dateStyle: "medium", timeStyle: "short" },
                )}
              </time>
            </div>
            <p>{message.body}</p>
          </li>
        ))}
      </ol>

      <form
        className="record-thread-compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length > 0) post.mutate();
        }}
      >
        <label htmlFor={`thread-draft-${contextId}`}>
          {txt("Add a note", "أضف ملاحظة")}
        </label>
        <textarea
          id={`thread-draft-${contextId}`}
          value={draft}
          maxLength={10_000}
          rows={3}
          placeholder={txt(
            "Customer asked for 8% off against a competitor quote…",
            "العميل طلب خصم ٨٪ مقابل عرض من منافس…",
          )}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <ErrorBanner
          error={post.error}
          retry={() => {
            post.mutate();
          }}
        />
        <button
          className="primary"
          disabled={post.isPending || draft.trim().length === 0}
        >
          {txt("Post", "سجّل")}
        </button>
      </form>
    </section>
  );
}
