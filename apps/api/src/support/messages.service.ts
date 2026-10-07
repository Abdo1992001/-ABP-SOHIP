import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { DatabaseClient, Prisma } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import type {
  CreateConversationDto,
  MessageAttachmentDto,
  MessageListQuery,
  MessageSearchQuery,
  ReactionDto,
  SendMessageDto,
} from "./messages.dto.js";

@Injectable()
export class MessagesService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async create(identity: CustomerIdentity, body: CreateConversationDto) {
    const userIds = [...new Set([identity.userId, ...body.participantUserIds])];
    if (body.typeCode === "DM" && userIds.length !== 2)
      invalid("DM_REQUIRES_TWO_PARTICIPANTS");
    if (body.typeCode === "GROUP" && userIds.length < 3)
      invalid("GROUP_REQUIRES_THREE_PARTICIPANTS");
    const activeUsers = await this.db.appUser.count({
      where: { id: { in: userIds }, active: true },
    });
    if (activeUsers !== userIds.length)
      invalid("CONVERSATION_PARTICIPANT_INVALID");
    const conversation = await this.db.conversation.create({
      data: {
        typeCode: body.typeCode,
        createdByUserId: identity.userId,
        ...(body.title === undefined ? {} : { title: body.title.trim() }),
        ...(body.businessContextType === undefined
          ? {}
          : { businessContextType: body.businessContextType }),
        ...(body.businessContextId === undefined
          ? {}
          : { businessContextId: body.businessContextId }),
        participants: {
          create: userIds.map((userId) => ({
            userId,
            roleCode: userId === identity.userId ? "OWNER" : "MEMBER",
          })),
        },
      },
      include: participantInclude,
    });
    await this.audit(
      identity,
      "CONVERSATION_CREATED",
      "CONVERSATION",
      conversation.id,
    );
    return { data: mapConversation(conversation) };
  }

  async list(identity: CustomerIdentity, query: MessageListQuery) {
    const skip = (query.page - 1) * query.limit;
    const where = {
      participants: { some: { userId: identity.userId, leftAt: null } },
    };
    const [total, conversations] = await this.db.$transaction([
      this.db.conversation.count({ where }),
      this.db.conversation.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          participants: { include: { user: { select: userSelect } } },
          messages: {
            where: { deletedAt: null },
            take: 1,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: { sender: { select: userSelect } },
          },
        },
      }),
    ]);
    return {
      data: conversations.map(mapConversation),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        hasNext: skip + conversations.length < total,
      },
    };
  }

  async detail(
    identity: CustomerIdentity,
    conversationId: string,
    query: MessageListQuery,
  ) {
    await this.membership(identity.userId, conversationId);
    const skip = (query.page - 1) * query.limit;
    const [conversation, total, messages] = await this.db.$transaction([
      this.db.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: participantInclude,
      }),
      this.db.message.count({ where: { conversationId, deletedAt: null } }),
      this.db.message.findMany({
        where: { conversationId, deletedAt: null },
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: messageInclude,
      }),
    ]);
    return {
      data: {
        ...mapConversation(conversation),
        messages: messages.map(mapMessage),
      },
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        hasNext: skip + messages.length < total,
      },
    };
  }

  async send(
    identity: CustomerIdentity,
    conversationId: string,
    body: SendMessageDto,
  ) {
    await this.membership(identity.userId, conversationId);
    if (body.replyToMessageId) {
      const reply = await this.db.message.findFirst({
        where: { id: body.replyToMessageId, conversationId },
      });
      if (!reply) missing();
    }
    const attachmentIds = [...new Set(body.attachmentIds ?? [])];
    if (attachmentIds.length) {
      const count = await this.db.messageAttachment.count({
        where: {
          id: { in: attachmentIds },
          conversationId,
          uploadedById: identity.userId,
          messageId: null,
        },
      });
      if (count !== attachmentIds.length) missing();
    }
    const message = await this.db.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderUserId: identity.userId,
          ...(body.replyToMessageId === undefined
            ? {}
            : { replyToMessageId: body.replyToMessageId }),
          body: body.body.trim(),
        },
      });
      if (attachmentIds.length) {
        await tx.messageAttachment.updateMany({
          where: { id: { in: attachmentIds }, messageId: null },
          data: { messageId: created.id },
        });
      }
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        include: messageInclude,
      });
    });
    await this.audit(identity, "MESSAGE_SENT", "MESSAGE", message.id);
    return { data: mapMessage(message) };
  }

  async markRead(identity: CustomerIdentity, conversationId: string) {
    await this.membership(identity.userId, conversationId);
    await this.db.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId: identity.userId },
      },
      data: { lastReadAt: new Date() },
    });
    return {
      data: { success: true, resourceId: conversationId, statusCode: "READ" },
    };
  }

  async react(
    identity: CustomerIdentity,
    messageId: string,
    body: ReactionDto,
  ) {
    const message = await this.db.message.findUnique({
      where: { id: messageId },
    });
    if (!message) missing();
    await this.membership(identity.userId, message.conversationId);
    await this.db.messageReaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: identity.userId,
          emoji: body.emoji,
        },
      },
      create: { messageId, userId: identity.userId, emoji: body.emoji },
      update: {},
    });
    return {
      data: { success: true, resourceId: messageId, statusCode: "REACTED" },
    };
  }

  /**
   * Who you can message.
   *
   * Without this the only way to start a conversation was to type a colleague's
   * user UUID, which nobody knows — so the messaging feature existed but could
   * not be used. Names and emails only; no roles, no permissions, no org data.
   */
  async directory(identity: CustomerIdentity, search?: string, limit = 50) {
    const term = (search ?? "").trim();
    const rows = await this.db.appUser.findMany({
      where: {
        active: true,
        id: { not: identity.userId },
        ...(term.length >= 2
          ? {
              OR: [
                {
                  displayName: { contains: term, mode: "insensitive" as const },
                },
                { emailNormalized: { contains: term.toLowerCase() } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        emailNormalized: true,
        profile: { select: { photoVisible: true, photoUpdatedAt: true } },
      },
      orderBy: [{ displayName: "asc" }],
      take: Math.min(Math.max(limit, 1), 200),
    });
    return {
      data: rows.map((row) => ({
        userId: row.id,
        displayName: row.displayName,
        email: row.emailNormalized,
        // Null when they have no photo or have chosen to hide it: the
        // directory draws initials in both cases.
        photoUpdatedAt:
          row.profile?.photoVisible === false
            ? null
            : (row.profile?.photoUpdatedAt?.toISOString() ?? null),
      })),
    };
  }

  async search(identity: CustomerIdentity, query: MessageSearchQuery) {
    const skip = (query.page - 1) * query.limit;
    const where = {
      deletedAt: null,
      body: { contains: query.q.trim(), mode: "insensitive" as const },
      conversation: {
        participants: { some: { userId: identity.userId, leftAt: null } },
      },
    };
    const [total, messages] = await this.db.$transaction([
      this.db.message.count({ where }),
      this.db.message.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: "desc" },
        include: messageInclude,
      }),
    ]);
    return {
      data: messages.map(mapMessage),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        hasNext: skip + messages.length < total,
      },
    };
  }

  async message(identity: CustomerIdentity, messageId: string) {
    const message = await this.db.message.findFirst({
      where: { id: messageId, deletedAt: null },
      include: messageInclude,
    });
    if (!message) missing();
    await this.membership(identity.userId, message.conversationId);
    return { data: mapMessage(message) };
  }

  async upload(
    identity: CustomerIdentity,
    conversationId: string,
    body: MessageAttachmentDto,
  ) {
    await this.membership(identity.userId, conversationId);
    const bytes = Buffer.from(body.contentBase64, "base64");
    if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024)
      invalid("ATTACHMENT_SIZE_INVALID");
    const id = randomUUID();
    const storageKey = `${id}.bin`;
    const directory = join(objectRoot(), "attachments");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, storageKey), bytes, {
      flag: "wx",
      mode: 0o640,
    });
    const attachment = await this.db.messageAttachment.create({
      data: {
        id,
        conversationId,
        uploadedById: identity.userId,
        storageKey,
        fileName: basename(body.fileName),
        contentType: body.contentType,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    return { data: mapAttachment(attachment) };
  }

  async download(identity: CustomerIdentity, attachmentId: string) {
    const attachment = await this.db.messageAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) missing();
    await this.membership(identity.userId, attachment.conversationId);
    return {
      attachment,
      bytes: await readFile(
        join(objectRoot(), "attachments", attachment.storageKey),
      ),
    };
  }

  /**
   * The thread attached to one commercial record.
   *
   * The conversation model already carried `businessContextType` /
   * `businessContextId`, but nothing ever set them: every conversation was a
   * DM or a group, reachable only from the Messages screen. So the one
   * conversation that decides a deal -- the back-and-forth over a price --
   * happened in WhatsApp, and the record kept the number without the reason.
   * When the person who negotiated it leaves, the reason leaves with them.
   *
   * A record thread is not a DM. Anyone who may see the record may read it,
   * and posting joins you; there is no invite step, because the participants
   * are "whoever is working this deal" and that list changes by itself.
   */
  async recordThread(
    identity: CustomerIdentity,
    contextType: string,
    contextId: string,
    query: MessageListQuery,
  ) {
    await this.requireRecordAccess(identity, contextType, contextId);
    const conversation = await this.db.conversation.findFirst({
      where: {
        businessContextType: contextType,
        businessContextId: contextId,
      },
      include: participantInclude,
      orderBy: { createdAt: "asc" },
    });
    if (!conversation)
      return {
        data: {
          conversationId: null,
          businessContextType: contextType,
          businessContextId: contextId,
          participants: [],
          messages: [],
        },
        meta: {
          page: query.page,
          limit: query.limit,
          total: 0,
          hasNext: false,
        },
      };
    const skip = (query.page - 1) * query.limit;
    const [total, messages] = await this.db.$transaction([
      this.db.message.count({
        where: { conversationId: conversation.id, deletedAt: null },
      }),
      this.db.message.findMany({
        where: { conversationId: conversation.id, deletedAt: null },
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: messageInclude,
      }),
    ]);
    return {
      data: {
        ...mapConversation(conversation),
        messages: messages.map(mapMessage),
      },
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        hasNext: skip + messages.length < total,
      },
    };
  }

  async postToRecord(
    identity: CustomerIdentity,
    contextType: string,
    contextId: string,
    body: SendMessageDto,
  ) {
    const label = await this.requireRecordAccess(
      identity,
      contextType,
      contextId,
    );
    const message = await this.db.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          businessContextType: contextType,
          businessContextId: contextId,
        },
        orderBy: { createdAt: "asc" },
      });
      const conversationId =
        existing?.id ??
        (
          await tx.conversation.create({
            data: {
              typeCode: "RECORD",
              title: label,
              createdByUserId: identity.userId,
              businessContextType: contextType,
              businessContextId: contextId,
            },
          })
        ).id;
      // Posting is the join. A record thread has no invite step.
      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: { conversationId, userId: identity.userId },
        },
        create: { conversationId, userId: identity.userId, roleCode: "MEMBER" },
        update: { leftAt: null },
      });
      const created = await tx.message.create({
        data: {
          conversationId,
          senderUserId: identity.userId,
          body: body.body.trim(),
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        include: messageInclude,
      });
    });
    await this.audit(identity, "MESSAGE_SENT", "MESSAGE", message.id);
    return { data: mapMessage(message) };
  }

  /**
   * You may read and write a record's thread exactly when you may see the
   * record. Returns a human label used to name the thread on first post.
   */
  private async requireRecordAccess(
    identity: CustomerIdentity,
    contextType: string,
    contextId: string,
  ): Promise<string> {
    const countries = [...identity.countryCodes];
    if (contextType === "OPPORTUNITY") {
      const row = await this.db.opportunity.findFirst({
        where: { id: contextId, countryCode: { in: countries } },
        select: { title: true, opportunityRef: true },
      });
      if (!row) missing();
      return row.title ?? row.opportunityRef;
    }
    if (contextType === "QUOTATION") {
      const row = await this.db.quotation.findFirst({
        where: { id: contextId, countryCode: { in: countries } },
        select: { quotationRef: true },
      });
      if (!row) missing();
      return row.quotationRef;
    }
    invalid("UNSUPPORTED_BUSINESS_CONTEXT");
  }

  private async membership(userId: string, conversationId: string) {
    const membership = await this.db.conversationParticipant.findFirst({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) missing();
    return membership;
  }

  private async audit(
    identity: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
  ) {
    await this.db.auditEvent.create({
      data: {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode,
        resourceType,
        resourceId,
        workspace: "COMMUNICATION",
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      },
    });
  }
}

const userSelect = {
  id: true,
  displayName: true,
  emailNormalized: true,
  profile: { select: { photoVisible: true, photoUpdatedAt: true } },
} as const;
const participantInclude = {
  participants: { include: { user: { select: userSelect } } },
} as const;
const messageInclude = {
  sender: { select: userSelect },
  reactions: { select: { userId: true, emoji: true } },
  attachments: true,
} as const;

interface ParticipantRow {
  userId: string;
  roleCode: string;
  lastReadAt: Date | null;
  user: {
    displayName: string;
    emailNormalized: string;
    profile?: { photoVisible: boolean; photoUpdatedAt: Date | null } | null;
  };
}
type AttachmentRow = Prisma.MessageAttachmentGetPayload<Record<string, never>>;
interface MessageRow {
  id: string;
  conversationId: string;
  senderUserId: string;
  replyToMessageId: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  sender: {
    displayName: string;
    profile?: { photoVisible: boolean; photoUpdatedAt: Date | null } | null;
  };
  reactions?: { userId: string; emoji: string }[];
  attachments?: AttachmentRow[];
}
interface ConversationRow {
  id: string;
  typeCode: string;
  title: string | null;
  businessContextType: string | null;
  businessContextId: string | null;
  createdAt: Date;
  updatedAt: Date;
  participants: ParticipantRow[];
  messages?: MessageRow[];
}

/** Null when there is no photo or its owner has hidden it. */
function avatarStamp(
  profile?: { photoVisible: boolean; photoUpdatedAt: Date | null } | null,
): string | null {
  if (!profile || !profile.photoVisible) return null;
  return profile.photoUpdatedAt?.toISOString() ?? null;
}

function mapConversation(row: ConversationRow) {
  return {
    conversationId: row.id,
    typeCode: row.typeCode,
    title: row.title,
    businessContextType: row.businessContextType,
    businessContextId: row.businessContextId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    participants: row.participants.map((participant) => ({
      userId: participant.userId,
      displayName: participant.user.displayName,
      photoUpdatedAt: avatarStamp(participant.user.profile),
      email: participant.user.emailNormalized,
      roleCode: participant.roleCode,
      lastReadAt: participant.lastReadAt?.toISOString() ?? null,
    })),
    ...(row.messages
      ? { latestMessage: row.messages[0] ? mapMessage(row.messages[0]) : null }
      : {}),
  };
}

function mapMessage(row: MessageRow) {
  return {
    messageId: row.id,
    conversationId: row.conversationId,
    senderUserId: row.senderUserId,
    senderName: row.sender.displayName,
    senderPhotoUpdatedAt: avatarStamp(row.sender.profile),
    replyToMessageId: row.replyToMessageId,
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    reactions:
      row.reactions?.map((reaction) => ({
        userId: reaction.userId,
        emoji: reaction.emoji,
      })) ?? [],
    attachments: row.attachments?.map(mapAttachment) ?? [],
  };
}

function mapAttachment(row: AttachmentRow) {
  return {
    attachmentId: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
  };
}

function objectRoot() {
  return process.env.ABP_LOCAL_OBJECT_ROOT ?? join(process.cwd(), "storage");
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
function invalid(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
