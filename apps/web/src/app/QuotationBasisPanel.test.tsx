import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QuotationBasisPanel,
  sheetNumber,
  sheetPercent,
  type BasisBlock,
} from "./QuotationBasisPanel.tsx";

/**
 * The panel's whole job is to say where a number came from. These check the
 * three things that claim can be wrong about: a derived row must not look
 * like an empty one, an overridden row must not look like a default, and a
 * row whose editor sits below it must not also carry a second editor.
 */

afterEach(cleanup);

function blocks(rows: BasisBlock["rows"]): BasisBlock[] {
  return [{ key: "b", title: { en: "Block", ar: "كتلة" }, rows }];
}

function renderPanel(rows: BasisBlock["rows"], editable = true) {
  render(
    <QuotationBasisPanel
      locale="en"
      editable={editable}
      blocks={blocks(rows)}
      activeBasis="Standard 77.76 EGP/kg"
      equation="77.76 EGP/kg × 32.149 kg = 2,500.00 EGP per reference board"
    />,
  );
}

describe("quotation basis panel", () => {
  it("flags a derived row AUTO rather than leaving it blank", () => {
    renderPanel([
      {
        key: "weight",
        label: { en: "Reference board weight (kg)", ar: "وزن اللوح" },
        setting: "32.149",
        override: null,
        applied: "32.149",
        tone: "auto",
      },
    ]);
    expect(screen.getByText("AUTO")).toBeTruthy();
    // A derived row has nothing to type into, so it offers no box.
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("marks the applied figure when this quotation overrode it", () => {
    renderPanel([
      {
        key: "density",
        label: { en: "Density (kg/m³)", ar: "الكثافة" },
        setting: "600.00",
        override: { value: "650", onChange: () => undefined },
        applied: "650.00",
      },
    ]);
    expect(screen.getByText("650.00").className.includes("is-overridden")).toBe(
      true,
    );
  });

  it("leaves the applied figure unmarked while the override is blank", () => {
    renderPanel([
      {
        key: "density",
        label: { en: "Density (kg/m³)", ar: "الكثافة" },
        setting: "600.00",
        override: { value: "", onChange: () => undefined },
        applied: "600.00",
      },
    ]);
    // Both the setting and the applied cell read 600.00 when nothing is
    // overridden, which is the point — so ask for the applied one by name.
    const applied = document.querySelector(".basis-applied");
    expect(applied?.textContent).toBe("600.00");
    expect(applied?.className.includes("is-overridden")).toBe(false);
  });

  it("reports what was typed into an override", async () => {
    const onChange = vi.fn();
    renderPanel([
      {
        key: "curved",
        label: { en: "Curved (EGP/kg)", ar: "Curved" },
        setting: "120.00",
        override: { value: "", onChange },
        applied: "120.00",
      },
    ]);
    await userEvent.type(screen.getByRole("spinbutton"), "9");
    expect(onChange).toHaveBeenCalledWith("9");
  });

  it("offers no second editor for a row edited by the control below it", () => {
    renderPanel([
      {
        key: "standard",
        label: { en: "Standard (EGP/kg)", ar: "Standard" },
        setting: "77.76",
        override: { value: "", onChange: () => undefined },
        applied: "77.76",
        wideControl: <input aria-label="board price" />,
      },
    ]);
    // Two boxes writing one number is how two boxes come to disagree.
    expect(screen.getAllByRole("textbox").length).toBe(1);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("does not take an edit on a quotation that can no longer be edited", () => {
    renderPanel(
      [
        {
          key: "curved",
          label: { en: "Curved (EGP/kg)", ar: "Curved" },
          setting: "120.00",
          override: { value: "120", onChange: () => undefined },
          applied: "120.00",
        },
      ],
      false,
    );
    expect(screen.getByRole("spinbutton").hasAttribute("readonly")).toBe(true);
  });

  it("states the basis and the equation in full", () => {
    renderPanel([]);
    expect(screen.getByText("Standard 77.76 EGP/kg")).toBeTruthy();
    expect(
      screen.getByText(
        "77.76 EGP/kg × 32.149 kg = 2,500.00 EGP per reference board",
      ),
    ).toBeTruthy();
  });
});

describe("sheet formatting", () => {
  it("writes numbers the way the workbook prints them", () => {
    expect(sheetNumber(2500, "en")).toBe("2,500.00");
    expect(sheetNumber(32.1494, "en", 3)).toBe("32.149");
    expect(sheetPercent(14, "en")).toBe("14.00%");
  });

  it("shows a dash rather than NaN when there is no figure", () => {
    expect(sheetNumber(Number.NaN, "en")).toBe("—");
  });
});
