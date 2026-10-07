import { createPortal } from "react-dom";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import type {
  PackingResult,
  PackingUnit,
  Placement,
} from "../lib/cargo-packing.ts";
import { containerManifest } from "../lib/cargo-report.ts";
import type { ViewName } from "../lib/cargo-report.ts";
import type { Shot } from "./CargoReport.tsx";

/**
 * The document a customer is sent.
 *
 * It is a page rather than a screen, read in the order a customer reads a
 * shipment: the whole of it first -- every container, and every product
 * across them -- then each container on its own page, what is in it and then
 * the pictures of it. ACROW's mark heads the report and every container, so a
 * page that travels alone still says whose it is. It prints — the browser's own print is what produces the PDF,
 * which keeps the thing the customer receives identical to the thing on screen
 * rather than a second rendering of it that can disagree.
 */

const VIEW_NAMES: Record<ViewName, { en: string; ar: string }> = {
  FRONT: { en: "From the doors", ar: "من ناحية الأبواب" },
  REAR: { en: "From the nose", ar: "من ناحية المقدمة" },
  LEFT: { en: "Left side", ar: "الجنب الشمال" },
  RIGHT: { en: "Right side", ar: "الجنب اليمين" },
  PLAN: { en: "From above", ar: "من فوق" },
};

export function CargoReportView({
  plan,
  unit,
  containerName,
  shots,
  colorOf,
  captionOf,
  boardsIn,
  nameOf,
  reference,
  onClose,
}: {
  plan: PackingResult;
  unit: PackingUnit;
  containerName: string;
  shots: readonly Shot[];
  colorOf: (itemId: string) => string;
  captionOf: (placement: Placement) => string;
  /** Boards in one placement, when the load is made up in a way that knows. */
  boardsIn?: ((placement: Placement) => number | null) | undefined;
  /** Which container a unit is, when the plan mixes a forty and a twenty. */
  nameOf?: ((code: string | undefined) => string) | undefined;
  /** The quotation or the day, so a printed copy can be matched to a shipment. */
  reference: string;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const num = (value: number, digits = 0) =>
    formatNum(value, locale, { maximumFractionDigits: digits });
  const percent = (share: number) => `${num(share * 100, 1)}%`;

  const manifests = plan.units.map((loaded, index) =>
    containerManifest(loaded, loaded.unit ?? unit, index, {
      groupKey: (itemId) => itemId.replace(/~rest$/, ""),
      ...(boardsIn === undefined ? {} : { boardsIn }),
    }),
  );
  const totalWeight = manifests.reduce((sum, one) => sum + one.weightKg, 0);
  const totalPieces = manifests.reduce((sum, one) => sum + one.pieces, 0);
  const totalBoards = manifests.every((one) => one.boards !== null)
    ? manifests.reduce((sum, one) => sum + (one.boards ?? 0), 0)
    : null;

  /** Every product across the shipment, and which containers carry it. */
  const products = new Map<
    string,
    {
      itemId: string;
      description: string;
      pieces: number;
      boards: number | null;
      weightKg: number;
      containers: number[];
    }
  >();
  const describe = (itemId: string, fallback: string, unitIndex: number) => {
    const sample = plan.units[unitIndex]?.placements.find(
      (placement) => placement.itemId.replace(/~rest$/, "") === itemId,
    );
    return sample === undefined ? fallback : captionOf(sample);
  };
  for (const manifest of manifests) {
    for (const row of manifest.rows) {
      const seen = products.get(row.itemId);
      if (seen === undefined) {
        products.set(row.itemId, {
          itemId: row.itemId,
          description: describe(
            row.itemId,
            row.description,
            manifest.number - 1,
          ),
          pieces: row.pieces,
          boards: row.boards,
          weightKg: row.weightKg,
          containers: [manifest.number],
        });
        continue;
      }
      seen.pieces += row.pieces;
      seen.boards =
        seen.boards === null || row.boards === null
          ? null
          : seen.boards + row.boards;
      seen.weightKg += row.weightKg;
      seen.containers.push(manifest.number);
    }
  }
  const unitName = (index: number) =>
    nameOf === undefined ? "" : nameOf(plan.units[index]?.containerCode);
  const logo = (
    <img
      className="cargo-report-logo"
      src="/acrow-logo.png"
      alt="ACROW Building Products"
    />
  );

  return createPortal(
    <div className="cargo-report print-root" role="dialog" aria-modal="true">
      <div className="cargo-report-bar">
        <button type="button" className="secondary" onClick={onClose}>
          {txt("Close", "اقفل")}
        </button>
        <button
          type="button"
          onClick={() => {
            window.print();
          }}
        >
          {txt("Print / save as PDF", "اطبع / احفظ PDF")}
        </button>
      </div>

      <article className="cargo-report-sheet">
        <header className="cargo-report-head">
          {logo}
          <div>
            <h1>{txt("Loading report", "تقرير التحميل")}</h1>
            <p>
              {reference} · {containerName} ·{" "}
              {txt(
                `${num(plan.units.length)} ${plan.units.length === 1 ? "container" : "containers"}`,
                `${num(plan.units.length)} ${plan.units.length === 1 ? "حاوية" : "حاويات"}`,
              )}
            </p>
          </div>
        </header>

        <section className="cargo-report-summary">
          <div>
            <dt>{txt("Containers", "الحاويات")}</dt>
            <dd>{num(plan.units.length)}</dd>
          </div>
          <div>
            <dt>{txt("Pieces loaded", "القطع المحمّلة")}</dt>
            <dd>{num(plan.placedPieces)}</dd>
          </div>
          {totalBoards !== null && (
            <div>
              <dt>{txt("Boards", "الألواح")}</dt>
              <dd>{num(totalBoards)}</dd>
            </div>
          )}
          <div>
            <dt>{txt("Total weight", "الوزن الكلي")}</dt>
            <dd>{num(totalWeight)} kg</dd>
          </div>
        </section>

        {/* The whole shipment on one page: every container, then every
            product across them. */}
        <section className="cargo-report-overview">
          <h2>{txt("All containers", "كل الحاويات")}</h2>
          <table className="cargo-report-table">
            <thead>
              <tr>
                <th>{txt("Container", "الحاوية")}</th>
                <th className="numeric">{txt("Pieces", "قطع")}</th>
                <th className="numeric">{txt("Boards", "ألواح")}</th>
                <th className="numeric">{txt("Weight", "الوزن")}</th>
                <th className="numeric">{txt("Payload", "الحمولة")}</th>
                <th className="numeric">{txt("Space", "المساحة")}</th>
              </tr>
            </thead>
            <tbody>
              {manifests.map((manifest) => (
                <tr key={manifest.number}>
                  <td>
                    <strong>
                      {txt(
                        `Container ${num(manifest.number)}`,
                        `حاوية ${num(manifest.number)}`,
                      )}
                    </strong>
                    {unitName(manifest.number - 1) !== "" &&
                      ` · ${unitName(manifest.number - 1)}`}
                  </td>
                  <td className="numeric">{num(manifest.pieces)}</td>
                  <td className="numeric">
                    {manifest.boards === null ? "—" : num(manifest.boards)}
                  </td>
                  <td className="numeric">{num(manifest.weightKg)} kg</td>
                  <td className="numeric">{percent(manifest.payloadUse)}</td>
                  <td className="numeric">{percent(manifest.volumeUse)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{txt("Total", "الإجمالي")}</th>
                <th className="numeric">{num(totalPieces)}</th>
                <th className="numeric">
                  {totalBoards === null ? "—" : num(totalBoards)}
                </th>
                <th className="numeric">{num(totalWeight)} kg</th>
                <th />
                <th />
              </tr>
            </tfoot>
          </table>

          <h2>{txt("What is shipped", "المنتجات المشحونة")}</h2>
          <table className="cargo-report-table">
            <thead>
              <tr>
                <th>{txt("Product", "المنتج")}</th>
                <th className="numeric">{txt("Pieces", "قطع")}</th>
                <th className="numeric">{txt("Boards", "ألواح")}</th>
                <th className="numeric">{txt("Weight", "الوزن")}</th>
                <th>{txt("In containers", "في الحاويات")}</th>
              </tr>
            </thead>
            <tbody>
              {[...products.values()].map((product) => (
                <tr key={product.itemId}>
                  <td>
                    <span
                      className="cargo-report-band"
                      style={{ background: colorOf(product.itemId) }}
                      aria-hidden="true"
                    />
                    {product.description}
                  </td>
                  <td className="numeric">{num(product.pieces)}</td>
                  <td className="numeric">
                    {product.boards === null ? "—" : num(product.boards)}
                  </td>
                  <td className="numeric">{num(product.weightKg)} kg</td>
                  <td>{product.containers.map((n) => num(n)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {plan.refused.length > 0 && (
          <p className="cargo-report-warn">
            {txt(
              "Some pieces are not on this plan; they are listed at the end.",
              "فيه قطع مش داخلة في الخطة دي؛ مكتوبة في الآخر.",
            )}
          </p>
        )}

        {manifests.map((manifest) => (
          <section className="cargo-report-unit" key={manifest.number}>
            <div className="cargo-report-unit-head">
              {logo}
              <span>{reference}</span>
            </div>
            <h2>
              {txt(
                `Container ${num(manifest.number)} of ${num(plan.units.length)}`,
                `حاوية ${num(manifest.number)} من ${num(plan.units.length)}`,
              )}
              {nameOf !== undefined &&
                ` · ${nameOf(plan.units[manifest.number - 1]?.containerCode)}`}
              <span>
                {num(manifest.weightKg)} kg · {txt("payload", "من الحمولة")}{" "}
                {percent(manifest.payloadUse)} · {txt("space", "من المساحة")}{" "}
                {percent(manifest.volumeUse)}
              </span>
            </h2>

            <table className="cargo-report-table">
              <thead>
                <tr>
                  <th>{txt("Product", "المنتج")}</th>
                  <th className="numeric">{txt("Pieces", "قطع")}</th>
                  <th className="numeric">{txt("Boards", "ألواح")}</th>
                  <th className="numeric">{txt("Weight", "الوزن")}</th>
                  <th className="numeric">{txt("Share", "النسبة")}</th>
                </tr>
              </thead>
              <tbody>
                {manifest.rows.map((row) => {
                  const sample = plan.units[
                    manifest.number - 1
                  ]?.placements.find(
                    (placement) =>
                      placement.itemId.replace(/~rest$/, "") === row.itemId,
                  );
                  return (
                    <tr key={row.itemId}>
                      <td>
                        <span
                          className="cargo-report-band"
                          style={{ background: colorOf(row.itemId) }}
                          aria-hidden="true"
                        />
                        {sample === undefined
                          ? row.description
                          : captionOf(sample)}
                      </td>
                      <td className="numeric">{num(row.pieces)}</td>
                      <td className="numeric">
                        {row.boards === null ? "—" : num(row.boards)}
                      </td>
                      <td className="numeric">{num(row.weightKg)} kg</td>
                      <td className="numeric">{percent(row.weightShare)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="cargo-report-shots">
              {(["FRONT", "REAR", "LEFT", "RIGHT", "PLAN"] as const).map(
                (view) => {
                  const shot = shots.find(
                    (one) =>
                      one.unitIndex === manifest.number - 1 &&
                      one.view === view,
                  );
                  return (
                    <figure key={view}>
                      {shot === undefined ? (
                        <div className="cargo-report-shot-missing">
                          {txt("No picture", "مفيش صورة")}
                        </div>
                      ) : (
                        <img
                          src={shot.dataUrl}
                          alt={txt(
                            `Container ${String(manifest.number)}, ${VIEW_NAMES[view].en}`,
                            `حاوية ${String(manifest.number)}، ${VIEW_NAMES[view].ar}`,
                          )}
                        />
                      )}
                      <figcaption>
                        {VIEW_NAMES[view][ar ? "ar" : "en"]}
                      </figcaption>
                    </figure>
                  );
                },
              )}
            </div>
          </section>
        ))}

        {plan.refused.length > 0 && (
          <section className="cargo-report-unit">
            <h2>{txt("Not loaded", "مش متحمّل")}</h2>
            <table className="cargo-report-table">
              <tbody>
                {plan.refused.map((refusal) => (
                  <tr key={refusal.itemId}>
                    <td>{refusal.label}</td>
                    <td className="numeric">{num(refusal.quantity)}</td>
                    <td>{refusal.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="cargo-report-foot">
          {txt(
            "Every figure on this report comes from the plan it illustrates: the pictures are the load as it was packed, not an impression of it.",
            "كل رقم في التقرير ده جاي من نفس الخطة اللي بيوصفها: الصور هي الحمولة زي ما اترصت بالظبط، مش تصوّر ليها.",
          )}
        </footer>
      </article>
    </div>,
    document.body,
  );
}
