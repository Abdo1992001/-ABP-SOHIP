import { describe, expect, it } from "vitest";
import {
  EMAIL_TYPES,
  TELEPHONE_TYPES,
  pickChannel,
  type ContactChannel,
} from "./contact-channels.ts";

const channels: readonly ContactChannel[] = [
  { channelTypeCode: "MOBILE", value: "+20 100 000 0001" },
  { channelTypeCode: "MOBILE", value: "+20 122 288 8776", isPrimary: true },
  { channelTypeCode: "EMAIL", value: "procurement@worca.example" },
  { channelTypeCode: "WHATSAPP", value: "+20 111 222 3333", isPrimary: true },
];

describe("pickChannel", () => {
  it("prefers the number marked primary over the first one recorded", () => {
    expect(pickChannel(channels, TELEPHONE_TYPES)).toBe("+20 122 288 8776");
  });

  it("falls back to the first when nothing is marked primary", () => {
    expect(
      pickChannel(
        [
          { channelTypeCode: "EMAIL", value: "first@worca.example" },
          { channelTypeCode: "EMAIL", value: "second@worca.example" },
        ],
        EMAIL_TYPES,
      ),
    ).toBe("first@worca.example");
  });

  it("takes a WhatsApp number when the contact has no mobile", () => {
    // They have given us a telephone number, filed under a different label.
    // A blank TEL box on a customs document is worse than the number they
    // actually answer.
    expect(
      pickChannel(
        [{ channelTypeCode: "WHATSAPP", value: "+20 111 222 3333" }],
        TELEPHONE_TYPES,
      ),
    ).toBe("+20 111 222 3333");
  });

  it("keeps the type order: a mobile beats a WhatsApp number", () => {
    expect(
      pickChannel(
        [
          { channelTypeCode: "WHATSAPP", value: "+20 111 222 3333" },
          { channelTypeCode: "MOBILE", value: "+20 100 000 0001" },
        ],
        TELEPHONE_TYPES,
      ),
    ).toBe("+20 100 000 0001");
  });

  it("ignores a channel recorded as blank or whitespace", () => {
    expect(
      pickChannel(
        [
          { channelTypeCode: "MOBILE", value: "   ", isPrimary: true },
          { channelTypeCode: "MOBILE", value: "+20 100 000 0001" },
        ],
        TELEPHONE_TYPES,
      ),
    ).toBe("+20 100 000 0001");
  });

  it("matches the type however it was cased or padded", () => {
    expect(
      pickChannel(
        [{ channelTypeCode: " email ", value: "a@b.example" }],
        ["EMAIL"],
      ),
    ).toBe("a@b.example");
  });

  it("returns nothing rather than a placeholder when there is no channel", () => {
    // The document prints this straight into a box, so "—" would be shipped
    // to a customs office as the buyer's telephone number.
    expect(pickChannel([], TELEPHONE_TYPES)).toBe("");
    expect(
      pickChannel(
        [{ channelTypeCode: "EMAIL", value: "a@b.example" }],
        TELEPHONE_TYPES,
      ),
    ).toBe("");
  });

  it("trims what it returns", () => {
    expect(
      pickChannel(
        [{ channelTypeCode: "MOBILE", value: "  +20 100 000 0001  " }],
        TELEPHONE_TYPES,
      ),
    ).toBe("+20 100 000 0001");
  });
});
