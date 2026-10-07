CREATE TABLE "conversations" (
  "conversation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type_code" TEXT NOT NULL,
  "title" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "business_context_type" TEXT,
  "business_context_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("conversation_id"),
  CONSTRAINT "conversations_type_check" CHECK ("type_code" IN ('DM', 'GROUP')),
  CONSTRAINT "conversations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT
);

CREATE TABLE "conversation_participants" (
  "conversation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_code" TEXT NOT NULL DEFAULT 'MEMBER',
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "left_at" TIMESTAMPTZ(6),
  "last_read_at" TIMESTAMPTZ(6),
  CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id", "user_id"),
  CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE,
  CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE
);

CREATE TABLE "messages" (
  "message_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "sender_user_id" UUID NOT NULL,
  "reply_to_message_id" UUID,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "messages_pkey" PRIMARY KEY ("message_id"),
  CONSTRAINT "messages_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 10000),
  CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE,
  CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT,
  CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("message_id") ON DELETE SET NULL
);

CREATE TABLE "message_reactions" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id", "user_id", "emoji"),
  CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE
);

CREATE TABLE "message_attachments" (
  "attachment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "message_id" UUID,
  "uploaded_by_user_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("attachment_id"),
  CONSTRAINT "message_attachments_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "message_attachments_size_check" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  CONSTRAINT "message_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE,
  CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "message_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT
);

CREATE INDEX "conversations_updated_at_conversation_id_idx" ON "conversations"("updated_at", "conversation_id");
CREATE INDEX "conversation_participants_user_id_left_at_conversation_id_idx" ON "conversation_participants"("user_id", "left_at", "conversation_id");
CREATE INDEX "messages_conversation_id_created_at_message_id_idx" ON "messages"("conversation_id", "created_at", "message_id");
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages"("reply_to_message_id");
CREATE INDEX "message_attachments_conversation_id_message_id_idx" ON "message_attachments"("conversation_id", "message_id");
