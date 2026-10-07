import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { DatabaseClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import type {
  UpdateMyProfileDto,
  UploadProfilePhotoDto,
} from "./profile.dto.js";

/**
 * A person's own profile: the part of their record they control.
 *
 * The split this file enforces is the important one. A user may change how
 * they appear — their photo, the name colleagues see, how to reach them. They
 * may not change what they are allowed to do. Role, country scope, manager,
 * team and account status are organisational facts set by administration and
 * are returned here read-only, so the screen can show them without implying
 * they are editable.
 */

/** Matches the product-image convention: bytes on the object store, not here. */
function objectRoot(): string {
  return process.env.ABP_LOCAL_OBJECT_ROOT ?? join(process.cwd(), "storage");
}

const PHOTO_DIR = "profile-photos";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/**
 * Trust the bytes, not the declared type. A caller can put any string in
 * contentType, so the file's own magic number decides, and anything that is
 * not one of these four raster formats is refused outright — an avatar is
 * never an SVG, which can carry script.
 */
function sniff(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a")
    return "image/png";
  if (bytes.length > 3 && bytes.toString("hex", 0, 3) === "ffd8ff")
    return "image/jpeg";
  if (bytes.length > 6 && bytes.toString("ascii", 0, 6) === "GIF89a")
    return "image/gif";
  if (
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async myProfile(identity: CustomerIdentity) {
    const profile = await this.db.userProfile.findUnique({
      where: { userId: identity.userId },
    });
    return { data: this.dto(identity, profile) };
  }

  /**
   * Only the fields a person owns. `displayName` is what colleagues see; the
   * account's own name and every access field are deliberately absent from
   * the DTO, so there is no request shape that could carry them.
   */
  async updateMyProfile(identity: CustomerIdentity, input: UpdateMyProfileDto) {
    const data: {
      displayName?: string;
      phone?: string | null;
      photoVisible?: boolean;
      phoneVisible?: boolean;
    } = {};
    if (input.displayName !== undefined)
      data.displayName = input.displayName.trim();
    if (input.phone !== undefined)
      data.phone = input.phone === null ? null : input.phone.trim() || null;
    if (input.photoVisible !== undefined)
      data.photoVisible = input.photoVisible;
    if (input.phoneVisible !== undefined)
      data.phoneVisible = input.phoneVisible;

    const profile = await this.db.userProfile.upsert({
      where: { userId: identity.userId },
      create: {
        userId: identity.userId,
        displayName: data.displayName ?? identity.displayName,
        ...(data.phone === undefined ? {} : { phone: data.phone }),
      },
      update: data,
    });
    return { data: this.dto(identity, profile) };
  }

  async uploadMyPhoto(
    identity: CustomerIdentity,
    input: UploadProfilePhotoDto,
  ) {
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length < 1)
      throw new ApiProblem({ status: 422, code: "PHOTO_EMPTY" });
    if (bytes.length > MAX_PHOTO_BYTES)
      throw new ApiProblem({ status: 422, code: "PHOTO_TOO_LARGE" });
    const contentType = sniff(bytes);
    if (!contentType)
      throw new ApiProblem({ status: 422, code: "PHOTO_NOT_AN_IMAGE" });

    const previous = await this.db.userProfile.findUnique({
      where: { userId: identity.userId },
      select: { photoStorageKey: true },
    });

    const storageKey = `${randomUUID()}.bin`;
    const directory = join(objectRoot(), PHOTO_DIR);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, storageKey), bytes, {
      flag: "wx",
      mode: 0o640,
    });

    const profile = await this.db.userProfile.upsert({
      where: { userId: identity.userId },
      create: {
        userId: identity.userId,
        displayName: identity.displayName,
        photoStorageKey: storageKey,
        photoContentType: contentType,
        photoSizeBytes: bytes.length,
        photoSha256: createHash("sha256").update(bytes).digest("hex"),
        photoUpdatedAt: new Date(),
      },
      update: {
        photoStorageKey: storageKey,
        photoContentType: contentType,
        photoSizeBytes: bytes.length,
        photoSha256: createHash("sha256").update(bytes).digest("hex"),
        photoUpdatedAt: new Date(),
      },
    });

    // A replaced avatar has no historical meaning -- unlike a product image,
    // which a sent quotation may still reference -- so the old file goes.
    if (previous?.photoStorageKey)
      await unlink(join(directory, previous.photoStorageKey)).catch(
        () => undefined,
      );

    return { data: this.dto(identity, profile) };
  }

  async removeMyPhoto(identity: CustomerIdentity) {
    const current = await this.db.userProfile.findUnique({
      where: { userId: identity.userId },
      select: { photoStorageKey: true },
    });
    const profile = await this.db.userProfile.update({
      where: { userId: identity.userId },
      data: {
        photoStorageKey: null,
        photoContentType: null,
        photoSizeBytes: null,
        photoSha256: null,
        photoUpdatedAt: null,
      },
    });
    if (current?.photoStorageKey)
      await unlink(
        join(objectRoot(), PHOTO_DIR, current.photoStorageKey),
      ).catch(() => undefined);
    return { data: this.dto(identity, profile) };
  }

  /**
   * Serve any colleague's avatar. Every authenticated user may see who they
   * work with, so there is no extra permission here; a user with no photo is
   * a 404 and the client falls back to initials rather than a broken image.
   */
  async readPhoto(_identity: CustomerIdentity, userId: string) {
    const profile = await this.db.userProfile.findUnique({
      where: { userId },
      select: {
        photoStorageKey: true,
        photoContentType: true,
        photoVisible: true,
      },
    });
    // Same 404 whether there is no photo or it is hidden: the client draws
    // initials either way, and the distinction is not the caller's business.
    const mine = userId === _identity.userId;
    if (
      !profile?.photoStorageKey ||
      !profile.photoContentType ||
      (!profile.photoVisible && !mine)
    )
      throw new ApiProblem({ status: 404, code: "PHOTO_NOT_FOUND" });
    return {
      contentType: profile.photoContentType,
      bytes: await readFile(
        join(objectRoot(), PHOTO_DIR, profile.photoStorageKey),
      ),
    };
  }

  /**
   * How one colleague appears to another.
   *
   * This is the only shape any other person's profile is ever returned in,
   * which is the point: a hidden field is absent from the object rather than
   * present and filtered by the screen drawing it. A privacy setting that has
   * to be remembered at every call site is one that will eventually be
   * forgotten at one of them.
   */
  async colleague(identity: CustomerIdentity, userId: string) {
    const user = await this.db.appUser.findFirst({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        emailNormalized: true,
        active: true,
        profile: {
          select: {
            displayName: true,
            jobTitle: true,
            phone: true,
            phoneVisible: true,
            photoVisible: true,
            photoUpdatedAt: true,
          },
        },
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!user) throw new ApiProblem({ status: 404, code: "USER_NOT_FOUND" });
    const maySeeCommercial =
      identity.permissions.has("accounts.view") &&
      !identity.deniedPermissions.has("accounts.view");
    return {
      data: {
        ...publicProfile(user),
        ...(maySeeCommercial
          ? {
              commercialPortfolio: await this.commercialPortfolio(userId, [
                ...identity.countryCodes,
              ]),
            }
          : {}),
      },
    };
  }

  private async commercialPortfolio(userId: string, countryCodes: string[]) {
    const now = new Date();
    const yearFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const activeTask = {
      OR: [
        { taskStatusCode: null },
        { taskStatusCode: { notIn: ["COMPLETED", "CANCELLED"] } },
      ],
    };
    const [
      customers,
      openOpportunities,
      wonThisYear,
      draftQuotations,
      sentQuotations,
      openActivities,
      overdueActivities,
    ] = await Promise.all([
      this.db.account.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          recordStatusCode: "ACTIVE",
        },
      }),
      this.db.opportunity.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          stageCode: { notIn: ["WON", "LOST"] },
          cancelledAt: null,
        },
      }),
      this.db.opportunity.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          stageCode: "WON",
          wonAt: { gte: yearFrom, lte: now },
        },
      }),
      this.db.quotation.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          statusCode: "DRAFT",
        },
      }),
      this.db.quotation.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          statusCode: { in: ["SENT", "SUBMITTED", "UNDER_REVIEW"] },
        },
      }),
      this.db.activity.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          ...activeTask,
        },
      }),
      this.db.activity.count({
        where: {
          ownerUserId: userId,
          countryCode: { in: countryCodes },
          dueAt: { lt: now },
          ...activeTask,
        },
      }),
    ]);
    return {
      customers,
      openOpportunities,
      wonThisYear,
      draftQuotations,
      sentQuotations,
      openActivities,
      overdueActivities,
    };
  }

  private dto(
    identity: CustomerIdentity,
    profile: {
      displayName: string;
      jobTitle: string | null;
      phone: string | null;
      teamId: string | null;
      managerUserId: string | null;
      photoUpdatedAt: Date | null;
      photoVisible?: boolean;
      phoneVisible?: boolean;
    } | null,
  ) {
    return {
      userId: identity.userId,
      // Editable by the person themselves.
      displayName: profile?.displayName ?? identity.displayName,
      phone: profile?.phone ?? null,
      hasPhoto: profile?.photoUpdatedAt != null,
      photoUpdatedAt: profile?.photoUpdatedAt?.toISOString() ?? null,
      photoVisible: profile?.photoVisible ?? true,
      phoneVisible: profile?.phoneVisible ?? true,
      // Shown, never edited here: these are organisational facts.
      email: identity.email,
      jobTitle: profile?.jobTitle ?? identity.jobTitle ?? null,
      teamId: profile?.teamId ?? identity.teamId ?? null,
      managerUserId: profile?.managerUserId ?? identity.managerUserId ?? null,
      countryCodes: [...identity.countryCodes],
      roles: identity.roles.map((role) => role.code),
    };
  }
}

/**
 * Build a colleague's public view. A hidden field is omitted, never blanked,
 * so there is no shape in which a hidden phone number travels to a client.
 */
function publicProfile(user: {
  id: string;
  displayName: string;
  emailNormalized: string;
  active: boolean;
  profile: {
    displayName: string;
    jobTitle: string | null;
    phone: string | null;
    phoneVisible: boolean;
    photoVisible: boolean;
    photoUpdatedAt: Date | null;
  } | null;
  roles: { role: { code: string } }[];
}) {
  const profile = user.profile;
  const showPhone = (profile?.phoneVisible ?? true) && Boolean(profile?.phone);
  const showPhoto =
    (profile?.photoVisible ?? true) && profile?.photoUpdatedAt != null;
  return {
    userId: user.id,
    // Always visible: the directory finds people by these, and work cannot be
    // assigned to someone whose role nobody can see.
    displayName: profile?.displayName ?? user.displayName,
    email: user.emailNormalized,
    jobTitle: profile?.jobTitle ?? null,
    roles: user.roles.map(({ role }) => role.code),
    // A deactivated colleague still appears in the history they are part of,
    // marked rather than erased.
    active: user.active,
    // Optional, and only present when its owner allows it.
    ...(showPhone ? { phone: profile?.phone } : {}),
    photoUpdatedAt: showPhoto
      ? (profile?.photoUpdatedAt?.toISOString() ?? null)
      : null,
  };
}
