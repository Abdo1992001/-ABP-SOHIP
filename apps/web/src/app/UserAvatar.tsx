import { useState } from "react";

/**
 * A person, drawn the same way everywhere.
 *
 * The rule this component exists to keep is that a user has exactly one
 * appearance. The profile is the source of truth; no screen stores its own
 * copy of a name or a photo, so changing your picture changes it in the
 * header, in a conversation, on an owner cell and in an activity at once.
 *
 * With no photo it draws initials rather than a silhouette, and the tint is
 * derived from the user's id — so a given person is the same colour on every
 * screen and on every load, instead of a random colour each render.
 */

const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * Abdelrahman Adel -> AA, أحمد عبد الرحمن -> أع. One initial for a
 * single-word name.
 *
 * Segmented rather than indexed: half the names in this company are Arabic,
 * where a letter can carry combining marks, so the first "character" is a
 * grapheme cluster and taking [0] of the string would cut one in half.
 */
function firstGrapheme(word: string): string {
  if (!graphemes) return word.slice(0, 1);
  for (const { segment } of graphemes.segment(word)) return segment;
  return "";
}

export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => firstGrapheme(part).toUpperCase())
    .join("");
}

/**
 * A stable tint per person. Deliberately not random: the same user must get
 * the same colour in the header, in a mention and in a table, every time.
 */
function tintOf(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 6;
}

export type AvatarSize = "sm" | "md" | "lg";

export function UserAvatar({
  userId,
  displayName,
  photoUpdatedAt,
  size = "md",
  className,
}: {
  userId: string;
  displayName: string;
  /**
   * The subject's photoUpdatedAt. Passing it both tells the component a photo
   * exists and busts the cache when it changes; leaving it out draws initials
   * without a network request, which is the right default for a list of
   * people whose photos the caller has not loaded.
   */
  photoUpdatedAt?: string | null | undefined;
  size?: AvatarSize;
  className?: string;
}) {
  // A photo that 404s or fails to decode falls back for the rest of this
  // mount rather than retrying and flashing a broken image.
  const [failed, setFailed] = useState(false);
  const classes = [`user-avatar is-${size}`, `tint-${String(tintOf(userId))}`];
  if (className) classes.push(className);

  const showPhoto = Boolean(photoUpdatedAt) && !failed;
  return (
    <span className={classes.join(" ")} aria-hidden="true">
      {showPhoto ? (
        <img
          src={`/api/v1/users/${userId}/avatar?v=${encodeURIComponent(
            photoUpdatedAt ?? "",
          )}`}
          alt=""
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        initialsOf(displayName)
      )}
    </span>
  );
}
