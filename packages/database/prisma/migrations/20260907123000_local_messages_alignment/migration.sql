-- Align the hand-authored messaging migration with Prisma's canonical defaults
-- and referential actions.

ALTER TABLE "conversation_participants" DROP CONSTRAINT "conversation_participants_conversation_id_fkey";
ALTER TABLE "conversation_participants" DROP CONSTRAINT "conversation_participants_user_id_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_created_by_user_id_fkey";
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_conversation_id_fkey";
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_message_id_fkey";
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_uploaded_by_user_id_fkey";
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_message_id_fkey";
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_user_id_fkey";
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_fkey";
ALTER TABLE "messages" DROP CONSTRAINT "messages_reply_to_message_id_fkey";
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_user_id_fkey";

ALTER TABLE "conversations"
  ALTER COLUMN "conversation_id" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "message_attachments" ALTER COLUMN "attachment_id" DROP DEFAULT;
ALTER TABLE "messages" ALTER COLUMN "message_id" DROP DEFAULT;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey"
  FOREIGN KEY ("sender_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey"
  FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("message_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
