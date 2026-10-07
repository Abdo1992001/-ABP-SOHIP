/**
 * Which of a contact's numbers goes on the document.
 *
 * A contact routinely holds more than one: a mobile and a WhatsApp number, a
 * work address and a personal one. `contact_channels` already records which is
 * primary, and that is the one a customs document should carry — so this picks
 * the primary and falls back to the first only when nothing is marked.
 *
 * The type list is ordered on purpose. A proforma's TEL box wants a telephone
 * number; a contact with no mobile but a WhatsApp number has given us a
 * telephone number, just filed differently, and printing nothing there because
 * the label did not match is worse than printing the number they answer.
 */

export interface ContactChannel {
  readonly channelTypeCode: string;
  readonly value: string;
  readonly isPrimary?: boolean;
}

export function pickChannel(
  channels: readonly ContactChannel[],
  types: readonly string[],
): string {
  for (const type of types) {
    const matches = channels.filter(
      (channel) =>
        channel.channelTypeCode.trim().toUpperCase() ===
          type.trim().toUpperCase() && channel.value.trim() !== "",
    );
    const chosen = matches.find((channel) => channel.isPrimary === true);
    const value = (chosen ?? matches[0])?.value.trim();
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

/** The order a telephone box is filled in, most specific first. */
export const TELEPHONE_TYPES = ["MOBILE", "PHONE", "WHATSAPP"] as const;
export const EMAIL_TYPES = ["EMAIL"] as const;
