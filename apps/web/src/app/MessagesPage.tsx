import { useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { UserAvatar } from "./UserAvatar.tsx";

interface MessageAttachment {
  attachmentId: string;
  fileName: string;
}
interface Message {
  messageId: string;
  senderUserId: string;
  senderName: string;
  senderPhotoUpdatedAt?: string | null;
  body: string;
  createdAt: string;
  attachments: MessageAttachment[];
}
interface Colleague {
  userId: string;
  displayName: string;
  email?: string;
}
interface Conversation {
  conversationId: string;
  title: string | null;
  participants: {
    userId: string;
    displayName: string;
    /** When this person last opened the conversation. */
    lastReadAt?: string | null;
  }[];
  latestMessage?: Message | null;
  messages?: Message[];
}

/**
 * Whether this conversation has something in it you have not seen.
 *
 * The server has tracked `lastReadAt` per participant all along and returns
 * it with every conversation — nothing was reading it, and nothing was ever
 * setting it, so every conversation looked identical whether or not somebody
 * had just written to you. Your own message never counts as unread: you were
 * there when it was sent.
 */
function hasUnread(conversation: Conversation, myUserId: string): boolean {
  const latest = conversation.latestMessage;
  if (!latest || latest.senderUserId === myUserId) return false;
  const mine = conversation.participants.find(
    (participant) => participant.userId === myUserId,
  );
  const lastRead = mine?.lastReadAt;
  if (lastRead === null || lastRead === undefined) return true;
  return new Date(latest.createdAt).getTime() > new Date(lastRead).getTime();
}

export function MessagesPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [body, setBody] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [search, setSearch] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [directorySearch, setDirectorySearch] = useState("");
  const [uploadError, setUploadError] = useState<unknown>(null);

  // A colleague picker, not a UUID field. Before this the only way to start a
  // conversation was to already know someone's user id, which meant the feature
  // shipped but could not actually be used.
  const directory = useQuery<Colleague[]>({
    queryKey: ["message-directory", directorySearch],
    queryFn: async () => {
      const result = await client.GET("/messages/directory", {
        params: {
          query: {
            ...(directorySearch.trim().length >= 2
              ? { search: directorySearch.trim() }
              : {}),
            limit: 100,
          },
        },
      });
      if (!result.data) throw new Error("DIRECTORY_LOAD_FAILED");
      return result.data.data as unknown as Colleague[];
    },
  });

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const result = await client.GET("/conversations", {
        params: { query: { page: 1, limit: 50 } },
      });
      if (!result.data) throw new Error("CONVERSATIONS_LOAD_FAILED");
      return result.data.data as unknown as Conversation[];
    },
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    queryKey: ["conversation", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      if (!selectedId) throw new Error("CONVERSATION_ID_REQUIRED");
      const result = await client.GET("/conversations/{conversationId}", {
        params: {
          path: { conversationId: selectedId },
          query: { page: 1, limit: 100 },
        },
      });
      if (!result.data) throw new Error("CONVERSATION_LOAD_FAILED");
      return result.data.data as unknown as Conversation;
    },
    refetchInterval: 5_000,
  });
  const searchResults = useQuery({
    queryKey: ["message-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const result = await client.GET("/messages/search", {
        params: { query: { q: search.trim(), page: 1, limit: 50 } },
      });
      if (!result.data) throw new Error("MESSAGE_SEARCH_FAILED");
      return result.data.data as unknown as Message[];
    },
  });
  const createConversation = useMutation({
    mutationFn: async () => {
      const result = await client.POST("/conversations", {
        body: { typeCode: "DM", participantUserIds: [participantId.trim()] },
      });
      if (!result.data) throw new Error("CONVERSATION_CREATE_FAILED");
      return result.data.data as unknown as Conversation;
    },
    onSuccess: (conversation) => {
      setParticipantId("");
      setSelectedId(conversation.conversationId);
      void cache.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const markRead = useMutation({
    mutationFn: (conversationId: string) =>
      client.POST("/conversations/{conversationId}/read", {
        params: { path: { conversationId } },
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("CONVERSATION_ID_REQUIRED");
      const result = await client.POST(
        "/conversations/{conversationId}/messages",
        {
          params: { path: { conversationId: selectedId } },
          body: {
            body: body.trim(),
            ...(attachmentIds.length ? { attachmentIds } : {}),
          },
        },
      );
      if (!result.data) throw new Error("MESSAGE_SEND_FAILED");
    },
    onSuccess: () => {
      setBody("");
      setAttachmentIds([]);
      void cache.invalidateQueries({ queryKey: ["conversation", selectedId] });
      void cache.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const upload = async (file: File) => {
    if (!selectedId) return;
    const contentBase64 = await fileBase64(file);
    const result = await client.POST(
      "/conversations/{conversationId}/attachments",
      {
        params: { path: { conversationId: selectedId } },
        body: {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64,
        },
      },
    );
    if (!result.data) throw new Error("ATTACHMENT_UPLOAD_FAILED");
    setAttachmentIds((current) => [...current, result.data.data.attachmentId]);
  };

  const submitMessage = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (body.trim()) send.mutate();
  };

  const rows: Message[] =
    (search.trim().length >= 2 ? searchResults.data : detail.data?.messages) ??
    [];
  return (
    <section className="messages-page">
      <aside className="conversation-list">
        <div className="messages-heading">
          <div>
            <p className="eyebrow" data-abp-caption>
              {txt("Communication", "التواصل")}
            </p>
            <h1>{txt("Messages", "الرسائل")}</h1>
          </div>
        </div>
        <form
          className="new-dm"
          onSubmit={(event) => {
            event.preventDefault();
            if (participantId) createConversation.mutate();
          }}
        >
          <input
            aria-label={txt("Find a colleague", "ابحث عن زميل")}
            placeholder={txt("Find a colleague", "ابحث عن زميل")}
            value={directorySearch}
            onChange={(event) => {
              setDirectorySearch(event.target.value);
            }}
          />
          <select
            aria-label={txt("Colleague", "الزميل")}
            value={participantId}
            onChange={(event) => {
              setParticipantId(event.target.value);
            }}
            required
          >
            <option value="">
              {directory.isLoading
                ? txt("Loading…", "جارٍ التحميل…")
                : txt("Choose a colleague", "اختر زميلاً")}
            </option>
            {(directory.data ?? []).map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="primary"
            disabled={createConversation.isPending || participantId === ""}
          >
            {txt("New DM", "محادثة جديدة")}
          </button>
        </form>
        <input
          className="message-search"
          aria-label={txt("Search messages", "بحث الرسائل")}
          placeholder={txt("Search your conversations", "ابحث في محادثاتك")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <ErrorBanner
          error={conversations.error}
          retry={() => {
            void conversations.refetch();
          }}
        />
        <ErrorBanner
          error={createConversation.error}
          retry={() => {
            createConversation.mutate();
          }}
        />
        <div className="conversation-scroll">
          {(conversations.data ?? []).map((conversation) => (
            <button
              key={conversation.conversationId}
              type="button"
              className={
                selectedId === conversation.conversationId
                  ? "conversation-row active"
                  : "conversation-row"
              }
              onClick={() => {
                setSelectedId(conversation.conversationId);
                setSearch("");
                if (hasUnread(conversation, me.user.userId))
                  markRead.mutate(conversation.conversationId);
              }}
            >
              <strong>{conversationTitle(conversation, me.user.userId)}</strong>
              <span>
                {conversation.latestMessage?.body ??
                  txt("No messages yet", "لا توجد رسائل بعد")}
              </span>
              {hasUnread(conversation, me.user.userId) && (
                <span
                  className="conversation-unread"
                  aria-label={txt("Unread", "غير مقروءة")}
                />
              )}
            </button>
          ))}
          {conversations.isLoading && (
            <p className="muted-copy">
              {txt("Loading conversations…", "جار تحميل المحادثات…")}
            </p>
          )}
        </div>
      </aside>
      <div className="message-panel">
        {!selectedId && search.trim().length < 2 ? (
          <div className="empty-message-state">
            <h2>{txt("Select a conversation", "اختر محادثة")}</h2>
            {/* The one moment on this screen with room to explain it, and the
                one moment somebody is looking at it without knowing what it
                is for. The narrow conversation rail has neither. */}
            <ScreenIntro screenId="MESSAGES" />
          </div>
        ) : (
          <>
            <header className="message-panel-header">
              <h2>
                {search.trim().length >= 2
                  ? txt("Search results", "نتائج البحث")
                  : detail.data
                    ? conversationTitle(detail.data, me.user.userId)
                    : txt("Conversation", "المحادثة")}
              </h2>
              <span>
                {detail.data?.participants.length ?? 0}{" "}
                {txt("participants", "مشاركين")}
              </span>
            </header>
            <ErrorBanner
              error={detail.error}
              retry={() => {
                void detail.refetch();
              }}
            />
            <ErrorBanner
              error={send.error}
              retry={() => {
                send.mutate();
              }}
            />
            <ErrorBanner
              error={uploadError}
              retry={() => {
                setUploadError(null);
              }}
            />
            <div className="message-thread" aria-live="polite">
              {rows.map((message: Message) => (
                <article
                  key={message.messageId}
                  className={
                    message.senderUserId === me.user.userId
                      ? "message-bubble mine"
                      : "message-bubble"
                  }
                >
                  <span className="message-sender">
                    <UserAvatar
                      userId={message.senderUserId}
                      displayName={message.senderName}
                      photoUpdatedAt={message.senderPhotoUpdatedAt}
                      size="sm"
                    />
                    <strong>{message.senderName}</strong>
                  </span>
                  <p>{message.body}</p>
                  {message.attachments.map((attachment) => (
                    <a
                      key={attachment.attachmentId}
                      href={`/api/v1/message-attachments/${attachment.attachmentId}/download`}
                    >
                      {attachment.fileName}
                    </a>
                  ))}
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString()}
                  </time>
                </article>
              ))}
            </div>
            {search.trim().length < 2 && (
              <form className="message-composer" onSubmit={submitMessage}>
                <label className="attachment-button">
                  {txt("Attach", "إرفاق")}
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        setUploadError(null);
                        upload(file).catch((error: unknown) => {
                          setUploadError(error);
                        });
                      }
                    }}
                  />
                </label>
                {attachmentIds.length > 0 && (
                  <span className="attachment-count">
                    {attachmentIds.length} {txt("attached", "مرفق")}
                  </span>
                )}
                <textarea
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                  }}
                  placeholder={txt("Write a message", "اكتب رسالة")}
                  maxLength={10000}
                  required
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={send.isPending}
                >
                  {txt("Send", "إرسال")}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function conversationTitle(conversation: Conversation, selfId: string) {
  return (
    conversation.title ??
    (conversation.participants
      .filter((participant) => participant.userId !== selfId)
      .map((participant) => participant.displayName)
      .join(", ") ||
      "Conversation")
  );
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
