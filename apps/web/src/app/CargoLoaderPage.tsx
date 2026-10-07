import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { rememberCargoPlan } from "../lib/cargo-handoff.ts";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows, str } from "./commercial-api.ts";
import { ErrorBanner, PageHeader } from "./CommercialUI.tsx";
import { BackgroundJob } from "./BackgroundJob.tsx";
import { CargoSheetUpload } from "./CargoSheetUpload.tsx";
import { containerManifest } from "../lib/cargo-report.ts";
import {
  boardWeightKg,
  densityLooksWrong,
  impliedDensityKgM3,
} from "../lib/board-weight.ts";
import { boardsFromLine } from "../lib/cargo-from-quotation.ts";
import { WORKBOOK } from "../lib/workbook-defaults.ts";
import { CargoDemoControl } from "./CargoDemoControl.tsx";
import type { Shot } from "./CargoReport.tsx";
import { formatNum, toNum } from "../lib/numbers.ts";
import {
  CARGO_CONTAINERS,
  containerByCode,
  DEFAULT_CONTAINER_CODE,
  innerVolumeM3,
  type CargoContainer,
} from "../lib/cargo-containers.ts";
import {
  bundleLine,
  DEFAULT_BUNDLING,
  parseBoardDimensions,
  type BoardLine,
  type BundleGroup,
  type BundlingSettings,
} from "../lib/cargo-bundling.ts";
import {
  cargoItems,
  fitBundling,
  fleetSummary,
  packFleet,
  type FleetResult,
  type FleetUnit,
  type LoadForm,
} from "../lib/cargo-load.ts";
import {
  describeLoading,
  type CargoItem,
  type PackingUnit,
  type Placement,
  type RefusalReason,
} from "../lib/cargo-packing.ts";

const CargoScene = lazy(() => import("./CargoScene.tsx"));
// The report pulls in a second canvas and the whole document; it is only worth
// downloading when somebody asks for one.
const CargoPhotoStage = lazy(() =>
  import("./CargoReport.tsx").then((module) => ({
    default: module.CargoPhotoStage,
  })),
);
const CargoReportView = lazy(() =>
  import("./CargoReportView.tsx").then((module) => ({
    default: module.CargoReportView,
  })),
);

/**
 * The Cargo Loader, rebuilt as part of the system rather than beside it.
 *
 * It used to be a separate application in an iframe with its own palette, its
 * own typography and its own idea of a button, so the one screen shown to a
 * customer looked least like the product. This is the same job in the CRM's
 * design system, and the arithmetic lives in `lib/`, unit-tested against
 * figures taken from real proformas.
 *
 * The chain it models is the one the business works in:
 *
 *   **boards → bundles → containers**
 *
 * A quotation sells boards. Nothing ships a loose board: same-size boards are
 * banded into bundles, and it is the bundle a forklift moves and a container
 * holds. So the screen answers both questions at once — how many boards go in
 * a bundle, and how many bundles go in a box — instead of leaving the first on
 * somebody's notepad.
 *
 * Two ways in, deliberately: from a quotation, which is the real workflow, and
 * by hand, which is how you answer "would this fit in a 40ft?" on a call
 * before any quotation exists.
 */

type Source = "QUOTATION" | "MANUAL";

const blankBoard = (n: number): BoardLine => ({
  id: `M${String(n)}`,
  description: "ACROW Board 15 mm x 1220 mm x 2440 mm",
  thicknessMm: 15,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: WORKBOOK.densityKgM3,
  // Derived, not typed: 1.22 x 2.44 x 0.015 x 600.
  unitWeightKg: 0,
  quantity: 300,
});

/**
 * A quotation line as a board.
 *
 * The engineering calculation stores the real dimensions on the line, so those
 * are read first. When it has not run, the description is parsed — every
 * proforma in the archive states the size in it — and only if both fail does
 * the standard board stand in, which is visibly wrong in a way somebody will
 * correct rather than plausibly wrong in a way nobody will.
 */
function lineToBoard(line: Record<string, unknown>, index: number): BoardLine {
  const snapshot = isObject(line.priceSnapshot) ? line.priceSnapshot : {};
  const inputs = isObject(snapshot.inputs) ? snapshot.inputs : {};
  const described =
    str(line.description) !== "—"
      ? str(line.description)
      : str(line.sectionLabel);
  const parsed = parseBoardDimensions(described);
  const perPiece = toNum(snapshot.calculatedWeightKg, 0);
  return {
    id: str(line.quotationLineId) || `L${String(index)}`,
    description: described === "—" ? `Line ${String(index + 1)}` : described,
    thicknessMm: toNum(inputs.thicknessMm, parsed?.thicknessMm ?? 15),
    widthMm: toNum(inputs.widthMm, parsed?.widthMm ?? 1220),
    lengthMm: toNum(inputs.lengthMm, parsed?.lengthMm ?? 2440),
    densityKgM3: toNum(inputs.densityKgM3, WORKBOOK.densityKgM3),
    // The quotation's own calculated weight is a stated weight: it is what the
    // line was priced on, so it is what the shipment is planned on. Without
    // one the density does the work.
    unitWeightKg: perPiece > 0 ? perPiece : 0,
    quantity: Math.max(1, Math.round(toNum(line.qty, 1))),
  };
}

/**
 * A dark band per bundle group.
 *
 * Dark on purpose: the scene is dark, the bundles are large, and a light fill
 * flares under the lighting. They are spaced around the wheel rather than
 * taken from the brand, because the job here is telling ten stacks apart — the
 * chrome around the scene is what carries the brand.
 */
export const BUNDLE_COLORS = [
  "#9d1c24",
  "#1f3a8a",
  "#14532d",
  "#7c2d12",
  "#4c1d95",
  "#0f4c5c",
  "#713f12",
  "#3f3f46",
  "#831843",
  "#1e3a34",
] as const;

const bandFor = (index: number): string =>
  BUNDLE_COLORS[(index < 0 ? 0 : index) % BUNDLE_COLORS.length] ?? "#9d1c24";

/**
 * The sea plan that books forties and puts the tail in a twenty.
 *
 * "Forty, twenty, or a mix of the two" is the question a shipment is booked
 * on, so the mix is offered beside the two single types, with the count each
 * one comes to, and the one that books least is chosen unless someone picks.
 */
const MIX_CODE = "ABP40+ABP20";
const MIX_BIG = "ABP40";
const MIX_SMALL = "ABP20";
const SEA_CHOICES = [MIX_BIG, MIX_SMALL, MIX_CODE] as const;

function packingUnitOf(container: CargoContainer): PackingUnit {
  return {
    innerLengthMm: container.innerLengthMm,
    innerWidthMm: container.innerWidthMm,
    innerHeightMm: container.innerHeightMm,
    doorWidthMm: container.doorWidthMm,
    doorHeightMm: container.doorHeightMm,
    payloadKg: container.payloadKg,
  };
}

/** The container(s) a code books: one type, or the forty-and-twenty mix. */
function fleetOf(
  code: string,
  overrides: Partial<CargoContainer>,
): { big: FleetUnit; small: FleetUnit | null; lead: CargoContainer } | null {
  if (code === MIX_CODE) {
    const big = containerByCode(MIX_BIG);
    const small = containerByCode(MIX_SMALL);
    if (big === undefined || small === undefined) return null;
    const lead = { ...big, ...overrides };
    return {
      lead,
      big: { code: big.code, unit: packingUnitOf(lead) },
      // The payload is a booking limit, and it is the same limit for both.
      small: {
        code: small.code,
        unit: packingUnitOf({ ...small, payloadKg: lead.payloadKg }),
      },
    };
  }
  const one = containerByCode(code);
  if (one === undefined) return null;
  const lead = { ...one, ...overrides };
  return {
    lead,
    big: { code: one.code, unit: packingUnitOf(lead) },
    small: null,
  };
}

/** Fewest units that carry everything, then the least container booked. */
function rankFleet(a: FleetResult, b: FleetResult): number {
  const aDone = a.refused.length === 0 ? 0 : 1;
  const bDone = b.refused.length === 0 ? 0 : 1;
  if (aDone !== bDone) return aDone - bDone;
  if (a.units.length !== b.units.length) return a.units.length - b.units.length;
  const booked = (r: FleetResult) =>
    r.units.reduce(
      (sum, u) =>
        sum +
        (u.unit.innerLengthMm * u.unit.innerWidthMm * u.unit.innerHeightMm) /
          1e9,
      0,
    );
  return booked(a) - booked(b);
}

export type TransportMode = "SEA" | "ROAD";

/**
 * How a shipment travels, and what that means for the fleet.
 *
 * Two, because ABP has two. Air is not here: there is no air unit in the fleet
 * the company gave us, and a mode offered with invented dimensions would plan
 * loads nobody can book.
 */
export const TRANSPORT_MODES: readonly {
  mode: TransportMode;
  name: { en: string; ar: string };
  note: { en: string; ar: string };
}[] = [
  {
    mode: "SEA",
    name: { en: "By sea", ar: "بحري" },
    note: {
      en: "ABP's own 40 ft and 20 ft boxes — 1,800 mm of internal height, which is what decides how many bundles go in.",
      ar: "حاويات أكرو ٤٠ و٢٠ قدم — ارتفاع داخلي ١٨٠٠ مم، وده اللي بيحدد عدد الحزم.",
    },
  },
  {
    mode: "ROAD",
    name: { en: "By road", ar: "بري" },
    note: {
      en: "Jumbo boxes at 4 m and 6 m, and the 13.6 m trailer. Taller, shorter, and limited by weight long before space.",
      ar: "صناديق جامبو ٤ و٦ متر، والتريلا ١٣.٦ متر. أعلى، أقصر، وبيقف عند الوزن قبل المساحة بكتير.",
    },
  },
];

/**
 * The unit a fleet leads with: the largest one ABP actually books for board.
 *
 * Largest, because that is the one that needs the fewest trips, and a count
 * quoted against anything else would understate what the fleet can do.
 */
function leadUnit(kind: TransportMode): CargoContainer | undefined {
  return CARGO_CONTAINERS.filter(
    (option) => option.kind === kind && option.primary,
  ).sort((a, b) => innerVolumeM3(b) - innerVolumeM3(a))[0];
}

export function CargoLoaderPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const [searchParams] = useSearchParams();

  const [source, setSource] = useState<Source>(() =>
    searchParams.get("quotationId") === null ? "MANUAL" : "QUOTATION",
  );
  const [quotationId, setQuotationId] = useState(
    () => searchParams.get("quotationId") ?? "",
  );
  const [manual, setManual] = useState<BoardLine[]>(() => [blankBoard(1)]);
  /**
   * Sea or road.
   *
   * A quotation opens on sea because that is where the 40/20/mix comparison
   * exists. The mode cards and tabs still let the planner switch to road in one
   * click, but the useful sea alternatives must not be hidden behind an
   * unanswered intermediate state.
   */
  const [mode, setMode] = useState<TransportMode | null>("SEA");
  const [containerCode, setContainerCode] = useState(DEFAULT_CONTAINER_CODE);
  // Until somebody picks a container, the sea plan follows the option that
  // books least -- forty, twenty or the mix.
  const [pickedContainer, setPickedContainer] = useState(false);
  const [bundling, setBundling] = useState<BundlingSettings>(DEFAULT_BUNDLING);
  /**
   * Banded bundles or loose boards.
   *
   * ABP loads both, and the choice changes what fits rather than only how it
   * looks: a bundle is one rigid block that carries its bearers and banding and
   * cannot be split across a layer, while loose boards stack to whatever height
   * is left. On an ABP 40 ft the difference is 400 boards against 280.
   */
  const [loadForm, setLoadForm] = useState<LoadForm>("BUNDLES");
  /**
   * Making the client report: taking the pictures, then reading them.
   *
   * IDLE until somebody asks, SHOOTING while the containers are photographed
   * one at a time, READY once the document can be opened. The shots are kept
   * separately from the state so closing the report does not throw away work
   * that took ten seconds to do.
   */
  const [reportStage, setReportStage] = useState<"IDLE" | "SHOOTING" | "READY">(
    "IDLE",
  );
  const [reportOpen, setReportOpen] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotProgress, setShotProgress] = useState({ done: 0, total: 0 });
  /**
   * How many pieces the demo has put in, or null when it is not playing.
   *
   * Null rather than "all of them" so the scene can tell a finished load from
   * a demo that happens to have reached the end: only the first draws without
   * thinking about loading order at all.
   */
  const [revealed, setRevealed] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Partial<CargoContainer>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unitIndex, setUnitIndex] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);

  const quotations = useQuery({
    queryKey: ["cargo-quotations"],
    queryFn: () =>
      commercialRequest(client, "GET", "/quotations", {
        path: {},
        query: { limit: 50 },
      }),
    enabled: source === "QUOTATION",
  });

  const detail = useQuery({
    queryKey: ["cargo-quotation", quotationId],
    queryFn: () =>
      commercialRequest(client, "GET", "/quotations/{quotationId}", {
        path: { quotationId },
      }),
    enabled: source === "QUOTATION" && quotationId !== "",
  });

  /** The quotation's own reference, so a printed report can be matched to it. */
  const quotationRef = useMemo(() => {
    const payload = detail.data?.data;
    const data =
      isObject(payload) && isObject(payload.data) ? payload.data : null;
    return data === null ? "" : str(data.quoteRef);
  }, [detail.data]);

  const quotationBoards: BoardLine[] = useMemo(() => {
    const payload = detail.data?.data;
    const data =
      isObject(payload) && isObject(payload.data) ? payload.data : null;
    if (data === null || !Array.isArray(data.lines)) return [];
    // One line, as many boards as it delivers. A column is one line on
    // the quotation and four different panels in the container, and the
    // line itself carries only the first of them -- so packing straight
    // off the line loaded every piece at the wrong size. See
    // cargo-from-quotation.ts.
    return data.lines
      .filter(isObject)
      .flatMap((line, index) => boardsFromLine(line, index, lineToBoard));
  }, [detail.data]);

  const boards = source === "QUOTATION" ? quotationBoards : manual;

  // The box the bundles are sized for. ABP's forty and twenty are the same
  // height, so choosing between them never changes the bundles.
  const heightBox = containerByCode(
    containerCode === MIX_CODE ? MIX_BIG : containerCode,
  );
  const fitHeightMm = overrides.innerHeightMm ?? heightBox?.innerHeightMm ?? 0;
  const fitted = useMemo(
    () => fitBundling(bundling, fitHeightMm),
    [bundling, fitHeightMm],
  );

  /**
   * Every board that can actually be planned, with its weight resolved.
   *
   * The weight is settled here rather than downstream because everything
   * downstream needs it: the bundling closes a bundle on weight, the packer
   * checks the payload, and the manifest reports the tonnage. A zero weight
   * reaching any of them produces a plan that looks finished and is wrong.
   */
  const usableBoards = boards
    .filter(
      (board) =>
        board.thicknessMm > 0 &&
        board.widthMm > 0 &&
        board.lengthMm > 0 &&
        board.quantity > 0,
    )
    .map((board) => ({
      ...board,
      unitWeightKg: boardWeightKg({
        thicknessMm: board.thicknessMm,
        widthMm: board.widthMm,
        lengthMm: board.lengthMm,
        densityKgM3: board.densityKgM3,
        statedKg: board.unitWeightKg,
      }).kg,
    }));

  // Boards become bundles first; the packer never sees a loose board. Keyed on
  // the values rather than the array identity, because the list is rebuilt on
  // every keystroke.
  const boardsKey = JSON.stringify(usableBoards);
  const groups: BundleGroup[] = useMemo(
    () =>
      (JSON.parse(boardsKey) as BoardLine[]).map((board) =>
        bundleLine(board, fitted),
      ),
    [boardsKey, fitted],
  );

  const bothCargo = useMemo(
    () => ({
      BUNDLES: cargoItems(groups, fitted, "BUNDLES"),
      BOARDS: cargoItems(groups, fitted, "BOARDS"),
    }),
    [groups, fitted],
  );

  const cargoKey = JSON.stringify(bothCargo);

  /**
   * Forty, twenty, or the two mixed: each packed for real, with its count.
   * Catalogue sizes, so the three are compared like for like.
   */
  const seaOptions = useMemo(() => {
    if (mode !== "SEA") return null;
    const items = (JSON.parse(cargoKey) as Record<LoadForm, CargoItem[]>)[
      loadForm
    ];
    if (items.length === 0) return null;
    const results = SEA_CHOICES.flatMap((code) => {
      const fleet = fleetOf(code, {});
      return fleet === null
        ? []
        : [{ code, result: packFleet(items, fleet.big, fleet.small) }];
    });
    // A mix that moved nothing into a twenty is the forty plan again, and a
    // card that repeats another is noise.
    const forty = results.find((one) => one.code === MIX_BIG);
    const shown = results.filter(
      (one) =>
        one.code !== MIX_CODE ||
        one.result.units.some((u) => u.containerCode === MIX_SMALL),
    );
    const best = [...shown].sort((a, b) => rankFleet(a.result, b.result))[0];
    return {
      results: shown,
      recommended: best?.code ?? forty?.code ?? null,
    };
  }, [cargoKey, loadForm, mode]);

  const activeCode =
    mode === "SEA" && !pickedContainer && seaOptions?.recommended
      ? seaOptions.recommended
      : containerCode;
  const fleet = fleetOf(activeCode, overrides);
  const container: CargoContainer | undefined = fleet?.lead;
  const unit: PackingUnit | undefined = fleet?.big.unit;
  const nameOf = (code: string | undefined): string =>
    (code === undefined ? undefined : containerByCode(code))?.name[
      ar ? "ar" : "en"
    ] ??
    container?.name[ar ? "ar" : "en"] ??
    "";

  const fleetKey = JSON.stringify(fleet);
  // Both ways, every time. "Would loose boards fit in fewer containers" is the
  // question the choice exists to answer, and an answer you have to switch the
  // screen to see is one nobody checks.
  const plans = useMemo(() => {
    const parsed = JSON.parse(fleetKey) as ReturnType<typeof fleetOf>;
    if (parsed === null) return null;
    const both = JSON.parse(cargoKey) as Record<LoadForm, CargoItem[]>;
    return {
      BUNDLES: packFleet(both.BUNDLES, parsed.big, parsed.small),
      BOARDS: packFleet(both.BOARDS, parsed.big, parsed.small),
    };
  }, [cargoKey, fleetKey]);
  const plan = plans === null ? null : plans[loadForm];
  // The plan for a quotation is handed to the shipment planner of its order.
  useEffect(() => {
    if (source !== "QUOTATION" || quotationId === "" || plan === null) return;
    if (plan.units.length === 0) return;
    rememberCargoPlan(quotationId, plan.units, plan.totalWeightKg);
  }, [source, quotationId, plan]);

  const shown =
    plan === null
      ? undefined
      : plan.units[Math.min(unitIndex, plan.units.length - 1)];
  const steps = shown === undefined ? [] : describeLoading(shown);

  /** The band a bundle gets — and the same band for its short bundle. */
  const colorOf = (itemId: string) =>
    bandFor(
      groups.findIndex(
        (group) => group.itemId === itemId.replace(/~rest$/, ""),
      ),
    );

  /**
   * What is cut into every physical bundle in the 3-D view: the description,
   * whole and unabbreviated, plus the boards carried by this bundle.
   *
   * Full bundles share one reusable marking texture; a short remainder bundle
   * gets its own board count. This keeps every box identifiable without
   * creating one GPU texture per serial number.
   */
  const captionOf = (placement: Placement): string => {
    const group = groups.find(
      (entry) => entry.itemId === placement.itemId.replace(/~rest$/, ""),
    );
    if (group === undefined) return placement.label;
    if (loadForm === "BOARDS") return group.description;
    const boards = placement.itemId.endsWith("~rest")
      ? group.remainderBoards
      : group.boardsPerBundle;
    return `${group.description}\nBundle • ${String(boards)} boards`;
  };

  const loose = loadForm === "BOARDS";
  /**
   * How many boards one placement stands for, which the manifest needs and
   * only this screen can answer: a loose piece is one board, a full bundle is
   * the group's count, and the short one is the remainder.
   */
  const boardsIn = (placement: Placement): number | null => {
    const group = groups.find(
      (entry) => entry.itemId === placement.itemId.replace(/~rest$/, ""),
    );
    if (group === undefined) return null;
    if (loadForm === "BOARDS") return 1;
    return placement.itemId.endsWith("~rest")
      ? group.remainderBoards
      : group.boardsPerBundle;
  };

  /**
   * What each mode would take, packed against its largest unit.
   *
   * The choice is between two fleets, so the honest way to put it is the
   * number of units each one needs — worked out by packing, not by dividing a
   * volume, which would count boards that do not fit through a door.
   */
  const modeCost = useMemo(() => {
    const items = cargoItems(groups, fitted, loadForm);
    const cost = (kind: TransportMode) => {
      const biggest = leadUnit(kind);
      if (biggest === undefined || items.length === 0) return null;
      const packed = packFleet(
        items,
        { code: biggest.code, unit: packingUnitOf(biggest) },
        null,
      );
      return {
        unit: biggest,
        units: packed.units.length,
        refused: packed.refused,
      };
    };
    return { SEA: cost("SEA"), ROAD: cost("ROAD") };
  }, [groups, fitted, loadForm]);

  /**
   * Picking a mode lands on the unit that mode's card quoted.
   *
   * Landing on the fleet's smallest unit instead would answer a card reading
   * "2 x Trailer 13 m" with a plan for seven Jumbos, which reads as the screen
   * contradicting itself within one click.
   */
  const chooseMode = (next: TransportMode) => {
    setMode(next);
    const lead = leadUnit(next);
    if (lead !== undefined) setContainerCode(lead.code);
    setPickedContainer(false);
    setOverrides({});
    setUnitIndex(0);
  };

  const totalBundles = groups.reduce(
    (sum, group) => sum + group.bundleCount,
    0,
  );
  const totalBoards = groups.reduce((sum, group) => sum + group.boardsTotal, 0);

  const patch = (index: number, value: Partial<BoardLine>) => {
    setManual((current) =>
      current.map((board, position) => {
        if (position !== index) return board;
        const next = { ...board, ...value };
        // Typing a description that states a size is the fastest way to enter
        // one, and it is how every proforma in the archive is written.
        if (value.description !== undefined) {
          const parsed = parseBoardDimensions(value.description);
          if (parsed !== null) return { ...next, ...parsed };
        }
        return next;
      }),
    );
  };

  const refusalText = (reason: RefusalReason) =>
    ({
      TOO_LONG: txt("Longer than the container", "أطول من الحاوية"),
      TOO_WIDE: txt("Wider than the container", "أعرض من الحاوية"),
      TOO_TALL: txt("Taller than the container", "أعلى من الحاوية"),
      DOOR_TOO_SMALL: txt(
        "Fits the container but not the doors",
        "داخل الحاوية بس مش من الباب",
      ),
      TOO_HEAVY: txt("Over the payload on its own", "أتقل من الحمولة لوحده"),
    })[reason];

  const setOverride = (key: keyof CargoContainer, value: number) => {
    setOverrides((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="cargo-page">
      <PageHeader
        screenId="CARGO_LOADER"
        kicker={txt("Logistics", "اللوجستيات")}
        title={txt("Cargo Loader", "محمّل الحاويات")}
        sub={txt(
          "Boards into bundles, bundles into containers — before anything is booked.",
          "ألواح تبقى حزم، وحزم تدخل حاويات — قبل ما يتحجز أي حاجة.",
        )}
        status={
          plan === null || plan.units.length === 0
            ? txt("Nothing to load yet", "مفيش حاجة تتحمّل لسه")
            : fleetSummary(plan.units, nameOf)
        }
        actions={
          <button
            type="button"
            className="abp-btn abp-btn-secondary"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((value) => !value);
            }}
          >
            {txt("Settings", "الإعدادات")}
          </button>
        }
      />

      <div
        className="cargo-source"
        role="tablist"
        aria-label={txt("Where the boards come from", "الألواح جاية منين")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={source === "QUOTATION"}
          className={source === "QUOTATION" ? "is-active" : ""}
          onClick={() => {
            setSource("QUOTATION");
          }}
        >
          {txt("From a quotation", "من عرض سعر")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "MANUAL"}
          className={source === "MANUAL" ? "is-active" : ""}
          onClick={() => {
            setSource("MANUAL");
          }}
        >
          {txt("Type the figures", "اكتب الأرقام")}
        </button>
      </div>

      <ErrorBanner
        error={quotations.error ?? detail.error}
        retry={() => {
          void quotations.refetch();
          void detail.refetch();
        }}
      />

      {settingsOpen && container !== undefined && (
        <section className="cargo-panel cargo-settings">
          <h2>{txt("Settings", "الإعدادات")}</h2>
          <p className="settings-hint">
            {txt(
              "How the factory bands a bundle, and what the line will book, are decisions made outside this screen. Change them here and every figure below follows.",
              "طريقة تحزيم المصنع وحد الحجز اللي الخط هيقبله قرارات بتتاخد بره الشاشة دي. غيّرهم من هنا وكل الأرقام تحت هتمشي وراهم.",
            )}
          </p>
          <div className="cargo-settings-grid">
            <label className="settings-field">
              {txt("Max bundle height (mm)", "أقصى ارتفاع حزمة (مم)")}
              <input
                type="number"
                min="0"
                value={bundling.maxBundleHeightMm}
                onChange={(event) => {
                  setBundling((current) => ({
                    ...current,
                    maxBundleHeightMm: toNum(event.target.value, 0),
                  }));
                }}
              />
              {fitted.maxBundleHeightMm < bundling.maxBundleHeightMm && (
                <small className="settings-hint">
                  {txt(
                    `Fitted to this container: up to ${formatNum(fitted.maxBundleHeightMm, locale)} mm, so bundles stack in whole layers.`,
                    `متظبطة على الحاوية دي: لحد ${formatNum(fitted.maxBundleHeightMm, locale)} مم، عشان الحزم تترص طبقات كاملة.`,
                  )}
                </small>
              )}
            </label>
            <label className="settings-field">
              {txt("Max bundle weight (kg)", "أقصى وزن حزمة (كجم)")}
              <input
                type="number"
                min="0"
                value={bundling.maxBundleWeightKg}
                onChange={(event) => {
                  setBundling((current) => ({
                    ...current,
                    maxBundleWeightKg: toNum(event.target.value, 0),
                  }));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Bearers and banding (mm)", "الخشب والتحزيم (مم)")}
              <input
                type="number"
                min="0"
                value={bundling.bundleBaseHeightMm}
                onChange={(event) => {
                  setBundling((current) => ({
                    ...current,
                    bundleBaseHeightMm: toNum(event.target.value, 0),
                  }));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Packing over net (%)", "زيادة التغليف فوق الصافي (٪)")}
              <input
                type="number"
                min="0"
                step="1"
                value={Math.round(bundling.packingAllowance * 100)}
                onChange={(event) => {
                  setBundling((current) => ({
                    ...current,
                    packingAllowance: toNum(event.target.value, 0) / 100,
                  }));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Length inside (mm)", "الطول الداخلي (مم)")}
              <input
                type="number"
                min="0"
                value={container.innerLengthMm}
                onChange={(event) => {
                  setOverride("innerLengthMm", toNum(event.target.value, 0));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Width inside (mm)", "العرض الداخلي (مم)")}
              <input
                type="number"
                min="0"
                value={container.innerWidthMm}
                onChange={(event) => {
                  setOverride("innerWidthMm", toNum(event.target.value, 0));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Height inside (mm)", "الارتفاع الداخلي (مم)")}
              <input
                type="number"
                min="0"
                value={container.innerHeightMm}
                onChange={(event) => {
                  setOverride("innerHeightMm", toNum(event.target.value, 0));
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Booked payload (kg)", "الحمولة المحجوزة (كجم)")}
              <input
                type="number"
                min="0"
                max={container.payloadCeilingKg}
                value={container.payloadKg}
                onChange={(event) => {
                  setOverride(
                    "payloadKg",
                    Math.min(
                      container.payloadCeilingKg,
                      toNum(event.target.value, 0),
                    ),
                  );
                }}
              />
              <small>
                {txt("Up to", "لحد")}{" "}
                {formatNum(container.payloadCeilingKg, locale)} kg
              </small>
            </label>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setBundling(DEFAULT_BUNDLING);
              setOverrides({});
            }}
          >
            {txt("Back to the defaults", "رجّع الافتراضي")}
          </button>
        </section>
      )}

      {/* Arriving from a quotation, this is the first thing asked: the
          shipment is priced, and how it travels is what has not been decided
          yet. It is skipped entirely when somebody opens the planner itself. */}
      {mode === null && (
        <section className="cargo-panel cargo-mode-step">
          <h2>{txt("How does it travel?", "هيسافر إزاي؟")}</h2>
          <p className="settings-hint">
            {txt(
              "The two fleets take a shipment differently, so the answer changes how many units it books. Both counts below come from packing these boards, not from dividing a volume.",
              "الأسطولين بياخدوا الشحنة بطريقة مختلفة، فالإجابة بتغيّر عدد الوحدات. العددين تحت جايين من رص الألواح فعلاً، مش من قسمة حجم.",
            )}
          </p>
          <div className="cargo-mode-grid">
            {TRANSPORT_MODES.map((entry) => {
              const cost = modeCost[entry.mode];
              return (
                <button
                  key={entry.mode}
                  type="button"
                  className="cargo-mode-card"
                  onClick={() => {
                    chooseMode(entry.mode);
                  }}
                >
                  <strong>{txt(entry.name.en, entry.name.ar)}</strong>
                  <span className="cargo-mode-count">
                    {cost === null
                      ? txt("Add boards first", "ضيف ألواح الأول")
                      : `${formatNum(cost.units, locale)} × ${cost.unit.name[ar ? "ar" : "en"]}`}
                  </span>
                  <span>{txt(entry.note.en, entry.note.ar)}</span>
                  {cost !== null && cost.refused.length > 0 && (
                    <span className="cargo-form-warn">
                      {txt(
                        "Some boards do not fit this fleet's largest unit.",
                        "فيه ألواح مش داخلة أكبر وحدة في الأسطول ده.",
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="settings-hint">
            {txt(
              "Either can be changed afterwards; nothing entered is lost by choosing.",
              "الاتنين ممكن يتغيّروا بعدين؛ مفيش حاجة مدخّلة بتضيع بالاختيار.",
            )}
          </p>
        </section>
      )}

      <div className="cargo-grid">
        <div className="cargo-column">
          <section className="cargo-panel">
            <h2>{txt("The boards", "الألواح")}</h2>

            {source === "QUOTATION" ? (
              <>
                <label className="settings-field">
                  {txt("Quotation", "عرض السعر")}
                  <select
                    value={quotationId}
                    onChange={(event) => {
                      setQuotationId(event.target.value);
                      setUnitIndex(0);
                    }}
                  >
                    <option value="">
                      {quotations.isLoading
                        ? txt("Loading…", "بيحمّل…")
                        : txt("Choose a quotation", "اختار عرض سعر")}
                    </option>
                    {rows(quotations.data?.data).map((row) => (
                      <option
                        key={str(row.quotationId)}
                        value={str(row.quotationId)}
                      >
                        {str(row.quoteRef)}
                      </option>
                    ))}
                  </select>
                </label>
                {quotationId !== "" &&
                  quotationBoards.length === 0 &&
                  !detail.isLoading && (
                    <p className="today-empty">
                      {txt(
                        "This quotation has no lines to load.",
                        "عرض السعر ده مفيهوش بنود تتحمّل.",
                      )}
                    </p>
                  )}
              </>
            ) : (
              <>
                {/* A sheet, when there is one. Typing forty board sizes
                    into a screen is where a 12 mm board becomes an 18 mm
                    one, and the sizes already exist in somebody's file. */}
                <CargoSheetUpload
                  onImported={(rows) => {
                    setManual(
                      rows.map((board) => ({
                        id: board.id,
                        description: board.description,
                        thicknessMm: board.thicknessMm,
                        widthMm: board.widthMm,
                        lengthMm: board.lengthMm,
                        densityKgM3: board.densityKgM3,
                        unitWeightKg: board.unitWeightKg,
                        quantity: board.quantity,
                      })),
                    );
                    setUnitIndex(0);
                  }}
                  labels={{
                    choose: txt("Load a sheet", "حمّل شيت"),
                    reading: txt("Reading…", "بيقرا…"),
                    template: txt("Download the ACROW sheet", "نزّل شيت أكرو"),
                    hint: txt(
                      "An Excel sheet with a Description, the three sizes and a Quantity. The weight is worked out from the density unless the sheet states one.",
                      "شيت إكسل فيه الوصف والمقاسات التلاتة والعدد. الوزن بيتحسب من الكثافة إلا لو الشيت كاتب وزن.",
                    ),
                    imported: (count) =>
                      txt(
                        `${formatNum(count, locale)} board size${count === 1 ? "" : "s"} loaded.`,
                        `اتحمّل ${formatNum(count, locale)} مقاس.`,
                      ),
                    problems: (count) =>
                      txt(
                        `${formatNum(count, locale)} row${count === 1 ? "" : "s"} to look at:`,
                        `${formatNum(count, locale)} صف محتاج نظرة:`,
                      ),
                    failed: txt(
                      "That file could not be read as a spreadsheet.",
                      "الملف ده ماتقراش كشيت إكسل.",
                    ),
                    dismiss: txt("Dismiss", "تمام"),
                  }}
                />

                <div className="enterprise-table-scroll">
                  <table className="data-table cargo-input-table">
                    <thead>
                      <tr>
                        <th>{txt("Description", "الوصف")}</th>
                        <th className="numeric">{txt("Thick", "السُمك")}</th>
                        <th className="numeric">{txt("Width", "العرض")}</th>
                        <th className="numeric">{txt("Length", "الطول")}</th>
                        <th className="numeric">
                          {txt("Density kg/m³", "الكثافة كجم/م³")}
                        </th>
                        <th className="numeric">
                          {txt("kg/board", "كجم/لوح")}
                        </th>
                        <th className="numeric">{txt("Boards", "الألواح")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {manual.map((board, index) => (
                        <tr key={board.id}>
                          <td>
                            <input
                              aria-label={txt("Board description", "وصف اللوح")}
                              value={board.description}
                              onChange={(event) => {
                                patch(index, {
                                  description: event.target.value,
                                });
                              }}
                            />
                          </td>
                          {(
                            [
                              [
                                "thicknessMm",
                                txt("Thickness in mm", "السُمك بالملي"),
                              ],
                              ["widthMm", txt("Width in mm", "العرض بالملي")],
                              ["lengthMm", txt("Length in mm", "الطول بالملي")],
                              [
                                "densityKgM3",
                                txt("Density in kg/m³", "الكثافة كجم/م³"),
                              ],
                            ] as const
                          ).map(([key, label]) => (
                            <td key={key} className="numeric">
                              <input
                                aria-label={label}
                                type="number"
                                min="0"
                                step="any"
                                value={board[key]}
                                onChange={(event) => {
                                  patch(index, {
                                    [key]: toNum(event.target.value, 0),
                                  });
                                }}
                              />
                            </td>
                          ))}
                          {/* The weight is the one figure here nobody should
                              type: it is width x length x thickness x density,
                              and typed by hand it goes stale the moment a
                              dimension changes. A weight that came from a
                              sheet is kept exactly as it arrived, and the cell
                              says so. */}
                          <td className="numeric cargo-weight-cell">
                            {(() => {
                              const derived = boardWeightKg({
                                thicknessMm: board.thicknessMm,
                                widthMm: board.widthMm,
                                lengthMm: board.lengthMm,
                                densityKgM3: board.densityKgM3,
                                statedKg: board.unitWeightKg,
                              });
                              const implied =
                                derived.source === "STATED"
                                  ? impliedDensityKgM3({
                                      thicknessMm: board.thicknessMm,
                                      widthMm: board.widthMm,
                                      lengthMm: board.lengthMm,
                                      statedKg: derived.kg,
                                    })
                                  : null;
                              const odd =
                                implied !== null && densityLooksWrong(implied);
                              return (
                                <>
                                  <input
                                    aria-label={txt(
                                      "Kilograms per board",
                                      "كجم للوح",
                                    )}
                                    type="number"
                                    min="0"
                                    step="any"
                                    placeholder={derived.kg.toFixed(3)}
                                    value={
                                      board.unitWeightKg > 0
                                        ? board.unitWeightKg
                                        : ""
                                    }
                                    onChange={(event) => {
                                      patch(index, {
                                        unitWeightKg: toNum(
                                          event.target.value,
                                          0,
                                        ),
                                      });
                                    }}
                                  />
                                  <span
                                    className={`cargo-weight-note${odd ? " is-warning" : ""}`}
                                  >
                                    {derived.source === "DERIVED"
                                      ? txt("auto", "تلقائي")
                                      : implied === null
                                        ? txt("stated", "مُعطى")
                                        : txt(
                                            `stated · ${formatNum(implied, locale)} kg/m³`,
                                            `مُعطى · ${formatNum(implied, locale)} كجم/م³`,
                                          )}
                                  </span>
                                </>
                              );
                            })()}
                          </td>
                          <td className="numeric">
                            <input
                              aria-label={txt("How many boards", "عدد الألواح")}
                              type="number"
                              min="0"
                              step="any"
                              value={board.quantity}
                              onChange={(event) => {
                                patch(index, {
                                  quantity: toNum(event.target.value, 0),
                                });
                              }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="ghost-button"
                              disabled={manual.length === 1}
                              onClick={() => {
                                setManual((current) =>
                                  current.filter((_, p) => p !== index),
                                );
                              }}
                            >
                              {txt("Remove", "شيل")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="settings-hint">
                  {txt(
                    "Paste a line like “ACROW Board 14.5mm x 882 mm x 1482 mm” into the description and the three sizes fill themselves in.",
                    "الصق سطر زي «ACROW Board 14.5mm x 882 mm x 1482 mm» في الوصف والمقاسات التلاتة هتتملي لوحدها.",
                  )}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setManual((current) => [
                      ...current,
                      blankBoard(current.length + 1),
                    ]);
                  }}
                >
                  {txt("Add a board size", "ضيف مقاس")}
                </button>
              </>
            )}
          </section>

          {groups.length > 0 && !loose && (
            <section className="cargo-panel">
              <h2>{txt("Boards to bundles", "من الألواح للحزم")}</h2>
              <div className="enterprise-table-scroll">
                <table className="data-table cargo-bundle-table">
                  <thead>
                    <tr>
                      <th>{txt("Bundle", "الحزمة")}</th>
                      <th className="numeric">{txt("Boards", "ألواح")}</th>
                      <th className="numeric">
                        {txt("Per bundle", "في الحزمة")}
                      </th>
                      <th className="numeric">{txt("Bundles", "حزم")}</th>
                      <th className="numeric">{txt("Height", "الارتفاع")}</th>
                      <th className="numeric">{txt("Weight", "الوزن")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group, index) => (
                      <tr key={group.itemId}>
                        <td>
                          <span
                            className="cargo-swatch"
                            style={{ background: bandFor(index) }}
                            aria-hidden="true"
                          />
                          {group.description}
                        </td>
                        <td className="numeric" data-abp-num>
                          {formatNum(group.boardsTotal, locale)}
                        </td>
                        <td className="numeric" data-abp-num>
                          {formatNum(group.boardsPerBundle, locale)}
                        </td>
                        {/* The breakdown goes under the count rather than
                            beside it: inline in a numeric cell it wrapped to
                            one character per line. */}
                        <td className="numeric cargo-bundles-cell" data-abp-num>
                          <span>{formatNum(group.bundleCount, locale)}</span>
                          {group.remainderBoards > 0 && (
                            <small className="cargo-remainder">
                              {formatNum(group.fullBundles, locale)}×
                              {formatNum(group.boardsPerBundle, locale)} +{" "}
                              {formatNum(group.remainderBoards, locale)}
                            </small>
                          )}
                        </td>
                        <td className="numeric" data-abp-num>
                          {formatNum(group.fullBundleHeightMm, locale)}
                        </td>
                        <td className="numeric" data-abp-num>
                          {formatNum(group.fullBundleWeightKg, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Which limit closed the bundle, because that is the one worth
                  changing if the count is not what the factory expects. */}
              <p className="settings-hint">
                {groups.every((group) => group.limitedBy === "WEIGHT")
                  ? txt(
                      "Every bundle here is closed by weight, not height — raising the banding height would change nothing.",
                      "كل الحزم دي بتتقفل بالوزن مش بالارتفاع — رفع ارتفاع التحزيم مش هيغيّر حاجة.",
                    )
                  : txt(
                      "Some bundles are closed by the banding height and some by weight; the table says which.",
                      "فيه حزم بتتقفل بارتفاع التحزيم وفيه بالوزن؛ الجدول بيقول كل واحدة.",
                    )}
              </p>
            </section>
          )}

          {groups.length > 0 && (
            <section className="cargo-panel">
              <h2>{txt("How it loads", "بيتحمّل إزاي")}</h2>
              <p className="settings-hint">
                {txt(
                  "The same boards, made up two ways. Both are packed against the container you picked, so the difference below is what the choice actually costs.",
                  "نفس الألواح، متجهّزة بطريقتين. الاتنين مرصوصين على الحاوية اللي اخترتها، فالفرق اللي تحت هو تكلفة الاختيار فعلاً.",
                )}
              </p>
              <div className="cargo-form-grid">
                {(
                  [
                    [
                      "BUNDLES",
                      txt("Banded bundles", "حزم مربوطة"),
                      txt(
                        "Strapped blocks on bearers — one forklift move each, and they cannot be split across a layer.",
                        "بلوكات مربوطة على خشب — حركة فوركليفت واحدة لكل واحدة، ومش بتتقسم على طبقتين.",
                      ),
                    ],
                    [
                      "BOARDS",
                      txt("Loose boards", "ألواح سايبة"),
                      txt(
                        "Stacked board by board — slower to load, and they use every millimetre of height.",
                        "بترص لوح لوح — أبطأ في التحميل، وبتستغل كل ملي في الارتفاع.",
                      ),
                    ],
                  ] as const
                ).map(([form, name, note]) => {
                  const its = plans?.[form];
                  return (
                    <button
                      key={form}
                      type="button"
                      className={`cargo-form-card ${form === loadForm ? "is-active" : ""}`}
                      aria-pressed={form === loadForm}
                      onClick={() => {
                        setLoadForm(form);
                        setUnitIndex(0);
                      }}
                    >
                      <strong>{name}</strong>
                      <span className="cargo-form-count">
                        {its === undefined
                          ? "—"
                          : fleetSummary(its.units, nameOf)}
                      </span>
                      <span>{note}</span>
                      {its !== undefined && its.refused.length > 0 && (
                        <span className="cargo-form-warn">
                          {txt(
                            "Some boards do not fit this container.",
                            "فيه ألواح مش داخلة الحاوية دي.",
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* The verdict, in one sentence, so the comparison does not
                  need reading twice. */}
              {plans !== null &&
                (() => {
                  const saved =
                    plans.BUNDLES.units.length - plans.BOARDS.units.length;
                  const many = formatNum(Math.abs(saved), locale);
                  const noun =
                    Math.abs(saved) === 1
                      ? txt("container", "حاوية")
                      : txt("containers", "حاويات");
                  return (
                    <p className="settings-hint">
                      {saved === 0
                        ? txt(
                            "Both ways book the same number of containers, so this is a handling decision, not a freight one.",
                            "الطريقتين بيحجزوا نفس عدد الحاويات، يبقى ده قرار مناولة مش قرار شحن.",
                          )
                        : saved > 0
                          ? txt(
                              `Loose boards save ${many} ${noun} over bundles.`,
                              `الألواح السايبة بتوفّر ${many} ${noun} عن الحزم.`,
                            )
                          : txt(
                              `Bundles save ${many} ${noun} over loose boards.`,
                              `الحزم بتوفّر ${many} ${noun} عن الألواح السايبة.`,
                            )}
                    </p>
                  );
                })()}
            </section>
          )}

          <section className="cargo-panel">
            <h2>{txt("What it goes in", "هتتحمّل في إيه")}</h2>
            {/* Changing your mind about the mode is two clicks, not a reload. */}
            <div
              className="cargo-mode-tabs"
              role="tablist"
              aria-label={txt("How it travels", "بيسافر إزاي")}
            >
              {TRANSPORT_MODES.map((entry) => (
                <button
                  key={entry.mode}
                  type="button"
                  role="tab"
                  aria-selected={mode === entry.mode}
                  className={mode === entry.mode ? "is-active" : ""}
                  onClick={() => {
                    chooseMode(entry.mode);
                  }}
                >
                  {txt(entry.name.en, entry.name.ar)}
                </button>
              ))}
            </div>
            <div className="cargo-container-grid">
              {CARGO_CONTAINERS.filter(
                (option) => mode === null || option.kind === mode,
              ).map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={`cargo-container-card ${option.code === activeCode ? "is-active" : ""}${option.primary ? "" : " is-secondary"}`}
                  aria-pressed={option.code === activeCode}
                  onClick={() => {
                    setContainerCode(option.code);
                    setPickedContainer(true);
                    setOverrides({});
                    setUnitIndex(0);
                  }}
                >
                  <strong>
                    {option.name[ar ? "ar" : "en"]}
                    {seaOptions?.recommended === option.code && (
                      <em className="cargo-best">{txt("Best", "الأفضل")}</em>
                    )}
                  </strong>
                  {(() => {
                    const count = seaOptions?.results.find(
                      (one) => one.code === option.code,
                    );
                    return count === undefined ? null : (
                      <span className="cargo-container-count">
                        {fleetSummary(count.result.units, nameOf)}
                      </span>
                    );
                  })()}
                  <span>
                    {formatNum(option.innerLengthMm, locale)} ×{" "}
                    {formatNum(option.innerWidthMm, locale)} ×{" "}
                    {formatNum(option.innerHeightMm, locale)} mm
                  </span>
                  <span>
                    {formatNum(option.payloadKg, locale)}{" "}
                    {txt("kg payload", "كجم حمولة صافية")} ·{" "}
                    {formatNum(innerVolumeM3(option), locale, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    m³
                  </span>
                </button>
              ))}
              {(() => {
                const mix = seaOptions?.results.find(
                  (one) => one.code === MIX_CODE,
                );
                if (mix === undefined) return null;
                return (
                  <button
                    key={MIX_CODE}
                    type="button"
                    className={`cargo-container-card cargo-container-mix ${activeCode === MIX_CODE ? "is-active" : ""}`}
                    aria-pressed={activeCode === MIX_CODE}
                    onClick={() => {
                      setContainerCode(MIX_CODE);
                      setPickedContainer(true);
                      setOverrides({});
                      setUnitIndex(0);
                    }}
                  >
                    <strong>
                      {txt("Best 40 ft + 20 ft mix", "أفضل مزيج ٤٠ + ٢٠ قدم")}
                      {seaOptions?.recommended === MIX_CODE && (
                        <em className="cargo-best">{txt("Best", "الأفضل")}</em>
                      )}
                    </strong>
                    <span className="cargo-container-count">
                      {fleetSummary(mix.result.units, nameOf)}
                    </span>
                    <span>
                      {txt(
                        "Every valid split is tested; this is the mix with the fewest total containers, then the least booked volume.",
                        "كل تقسيم صالح بيتجرب؛ وده المزيج الأقل في إجمالي الحاويات، وبعده الأقل في الحجم المحجوز.",
                      )}
                    </span>
                  </button>
                );
              })()}
            </div>
          </section>
        </div>

        <div className="cargo-column">
          <section className="cargo-panel cargo-result">
            <h2>{txt("The plan", "الخطة")}</h2>

            <dl className="cargo-kpis">
              <div>
                <dt>{txt("Containers", "الحاويات")}</dt>
                <dd>{formatNum(plan?.units.length ?? 0, locale)}</dd>
              </div>
              <div>
                <dt>
                  {loose ? txt("Loading", "التحميل") : txt("Bundles", "الحزم")}
                </dt>
                <dd>
                  {loose
                    ? txt("Loose boards", "ألواح سايبة")
                    : formatNum(totalBundles, locale)}
                </dd>
              </div>
              <div>
                <dt>{txt("Boards", "الألواح")}</dt>
                <dd>{formatNum(totalBoards, locale)}</dd>
              </div>
              <div>
                <dt>{txt("Gross weight", "الوزن القائم")}</dt>
                <dd>{formatNum(plan?.totalWeightKg ?? 0, locale)} kg</dd>
              </div>
              <div
                className={
                  shown !== undefined && shown.payloadUse > 0.95
                    ? "is-warning"
                    : ""
                }
              >
                <dt>{txt("Payload used", "استغلال الحمولة")}</dt>
                <dd>
                  {formatNum((shown?.payloadUse ?? 0) * 100, locale, {
                    maximumFractionDigits: 1,
                  })}
                  %
                </dd>
              </div>
              <div>
                <dt>{txt("Space used", "استغلال المساحة")}</dt>
                <dd>
                  {formatNum((shown?.volumeUse ?? 0) * 100, locale, {
                    maximumFractionDigits: 1,
                  })}
                  %
                </dd>
              </div>
            </dl>

            {plan !== null && plan.refused.length > 0 && (
              <div className="cargo-refusals">
                <strong>{txt("Will not go in", "مش هيدخل")}</strong>
                <ul>
                  {plan.refused.map((refusal) => (
                    <li key={refusal.itemId}>
                      <span>{refusal.label}</span>
                      <em>
                        × {formatNum(refusal.quantity, locale)} ·{" "}
                        {refusalText(refusal.reason)}
                      </em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Every container in the plan, not only the one being drawn.
                This is what a freight booking is made from: how many units,
                what is in each, what it weighs and how much of the payload
                that is. The bands match the drawing, so a row and a stack are
                the same product in the same colour. */}
            {plan !== null && plan.units.length > 0 && unit !== undefined && (
              <div className="enterprise-table-scroll cargo-manifest-scroll">
                <table className="data-table cargo-manifest-table">
                  <thead>
                    <tr>
                      <th>{txt("Container", "الحاوية")}</th>
                      <th>{txt("What is in it", "اللي جواها")}</th>
                      <th className="numeric">{txt("Pieces", "قطع")}</th>
                      <th className="numeric">{txt("Boards", "ألواح")}</th>
                      <th className="numeric">{txt("Weight", "الوزن")}</th>
                      <th className="numeric">{txt("Payload", "الحمولة")}</th>
                      <th className="numeric">{txt("Space", "المساحة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.units.map((loaded, index) => {
                      const manifest = containerManifest(
                        loaded,
                        loaded.unit,
                        index,
                        {
                          groupKey: (itemId) => itemId.replace(/~rest$/, ""),
                          boardsIn,
                        },
                      );
                      const tight = manifest.payloadUse > 0.95;
                      return (
                        <tr
                          key={loaded.index}
                          className={
                            loaded.index === unitIndex ? "is-active" : ""
                          }
                          onClick={() => {
                            setUnitIndex(loaded.index);
                          }}
                        >
                          <td>
                            <strong>
                              {txt("Container", "حاوية")}{" "}
                              {formatNum(manifest.number, locale)}
                            </strong>
                            <span className="cargo-manifest-unit">
                              {nameOf(loaded.containerCode)}
                            </span>
                          </td>
                          <td>
                            <ul className="cargo-manifest-contents">
                              {manifest.rows.map((row) => (
                                <li key={row.itemId}>
                                  <span
                                    className="cargo-manifest-band"
                                    style={{ background: colorOf(row.itemId) }}
                                    aria-hidden="true"
                                  />
                                  {row.description}
                                  <em>
                                    {row.boards === null
                                      ? txt(
                                          `${formatNum(row.pieces, locale)} pcs`,
                                          `${formatNum(row.pieces, locale)} قطعة`,
                                        )
                                      : txt(
                                          `${formatNum(row.boards, locale)} boards`,
                                          `${formatNum(row.boards, locale)} لوح`,
                                        )}
                                  </em>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="numeric">
                            {formatNum(manifest.pieces, locale)}
                          </td>
                          <td className="numeric">
                            {manifest.boards === null
                              ? "—"
                              : formatNum(manifest.boards, locale)}
                          </td>
                          <td className="numeric">
                            {formatNum(manifest.weightKg, locale)} kg
                          </td>
                          <td
                            className={`numeric ${tight ? "is-warning" : ""}`}
                          >
                            {formatNum(manifest.payloadUse * 100, locale, {
                              maximumFractionDigits: 1,
                            })}
                            %
                          </td>
                          <td className="numeric">
                            {formatNum(manifest.volumeUse * 100, locale, {
                              maximumFractionDigits: 1,
                            })}
                            %
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {plan !== null && plan.units.length > 0 && (
              <div className="cargo-report-launch">
                <button
                  type="button"
                  className="secondary"
                  disabled={reportStage === "SHOOTING"}
                  onClick={() => {
                    // A fresh set of pictures every time: the plan behind them
                    // may have changed since the last ones were taken.
                    setShots([]);
                    setShotProgress({ done: 0, total: plan.units.length });
                    setReportStage("SHOOTING");
                  }}
                >
                  {reportStage === "SHOOTING"
                    ? txt("Preparing the report…", "بيجهّز التقرير…")
                    : txt("Client report", "تقرير العميل")}
                </button>
                <span className="settings-hint">
                  {txt(
                    "Every container from four sides, with what is in it — the document that goes to the customer.",
                    "كل حاوية من 4 اتجاهات، وبمحتوياتها — المستند اللي بيروح للعميل.",
                  )}
                </span>
              </div>
            )}

            {plan !== null && plan.units.length > 1 && (
              <div className="cargo-unit-picker">
                {plan.units.map((loaded) => (
                  <button
                    key={loaded.index}
                    type="button"
                    className={loaded.index === unitIndex ? "is-active" : ""}
                    aria-pressed={loaded.index === unitIndex}
                    onClick={() => {
                      setUnitIndex(loaded.index);
                    }}
                  >
                    {txt("Container", "حاوية")}{" "}
                    {formatNum(loaded.index + 1, locale)} ·{" "}
                    {formatNum(loaded.placements.length, locale)}
                  </button>
                ))}
              </div>
            )}

            {unit !== undefined && (
              <Suspense
                fallback={
                  <p className="cargo-scene-empty">
                    {txt("Preparing the view…", "بيجهّز العرض…")}
                  </p>
                }
              >
                <CargoScene
                  loaded={shown}
                  unit={shown?.unit ?? unit}
                  colorOf={colorOf}
                  captionOf={captionOf}
                  revealed={revealed ?? undefined}
                  highlightItemId={highlight}
                  emptyLabel={txt(
                    "Add a board size, or pick a quotation, and the load appears here.",
                    "ضيف مقاس لوح، أو اختار عرض سعر، والحمولة هتبان هنا.",
                  )}
                  noGraphicsLabel={txt(
                    "This browser cannot draw in 3D, so the picture is unavailable. Every figure on this screen is still correct — only the view is missing.",
                    "المتصفح ده مش قادر يرسم ثلاثي الأبعاد، فالصورة مش هتبان. كل الأرقام في الشاشة دي صح برضه — الناقص هو العرض بس.",
                  )}
                />
              </Suspense>
            )}

            {shown !== undefined && shown.placements.length > 0 && (
              <CargoDemoControl
                pieces={shown.placements.length}
                revealed={revealed ?? shown.placements.length}
                onRevealed={setRevealed}
                canvasOf={() =>
                  document.querySelector<HTMLCanvasElement>(
                    ".cargo-scene canvas",
                  )
                }
                reference={
                  source === "QUOTATION" && quotationRef !== ""
                    ? quotationRef
                    : "load"
                }
                labels={{
                  title: txt("Loading demo", "ديمو التحميل"),
                  hint: txt(
                    "Floor first, nose first, then across — the order a crew works in. Record it to send the customer a file.",
                    "الأرضية الأول، من المقدمة، وبعدين بالعرض — نفس ترتيب شغل الونش. سجّلها عشان تبعت للعميل ملف.",
                  ),
                  play: txt("Play", "شغّل"),
                  pause: txt("Pause", "وقف"),
                  restart: txt("Play again", "شغّل تاني"),
                  speed: txt("Speed", "السرعة"),
                  record: txt("Record a video", "سجّل فيديو"),
                  recording: txt("Recording…", "بيسجّل…"),
                  download: txt("Download the video", "حمّل الفيديو"),
                  unavailable: txt(
                    "This browser cannot record the canvas, so the demo plays but cannot be saved.",
                    "المتصفح ده مش بيسجّل الكانفس، فالديمو بيشتغل بس مش بيتحفظ.",
                  ),
                  progress: txt("Pieces loaded", "القطع المحمّلة"),
                }}
              />
            )}

            {groups.length > 0 && (
              <ul className="cargo-legend">
                {groups.map((group, index) => (
                  <li key={group.itemId}>
                    <button
                      type="button"
                      className={highlight === group.itemId ? "is-active" : ""}
                      onClick={() => {
                        setHighlight((current) =>
                          current === group.itemId ? null : group.itemId,
                        );
                      }}
                    >
                      <span
                        className="cargo-swatch"
                        style={{ background: bandFor(index) }}
                        aria-hidden="true"
                      />
                      {group.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {steps.length > 0 && (
              <div className="cargo-steps">
                <h3>
                  {txt("How it is loaded", "بتتحمّل إزاي")} ·{" "}
                  {txt("Container", "حاوية")} {formatNum(unitIndex + 1, locale)}
                </h3>
                <ol>
                  {steps.map((step) => (
                    <li key={step.layer}>
                      <strong>
                        {txt("Layer", "طبقة")} {formatNum(step.layer, locale)}
                      </strong>
                      <span>
                        {formatNum(step.pieces, locale)}{" "}
                        {txt("bundles", "حزمة")} ·{" "}
                        {formatNum(step.rows, locale)} {txt("rows", "صف")} ·{" "}
                        {formatNum(step.weightKg, locale)} kg
                      </span>
                      <em>
                        {step.contents
                          .map(
                            (part) =>
                              `${part.label} × ${formatNum(part.count, locale)}`,
                          )
                          .join(" · ")}
                      </em>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* The pictures are taken off-screen, one container at a time, while the
          person carries on using the planner. */}
      {reportStage === "SHOOTING" && plan !== null && unit !== undefined && (
        <Suspense fallback={null}>
          <CargoPhotoStage
            plan={plan}
            unit={unit}
            colorOf={colorOf}
            captionOf={captionOf}
            onProgress={setShotProgress}
            onFinished={(taken) => {
              setShots(taken);
              setReportStage("READY");
            }}
          />
        </Suspense>
      )}

      {reportStage !== "IDLE" && (
        <BackgroundJob
          title={txt("Client report", "تقرير العميل")}
          detail={
            reportStage === "SHOOTING"
              ? txt(
                  `Photographing container ${formatNum(Math.min(shotProgress.done + 1, shotProgress.total), locale)} from four sides…`,
                  `بيصوّر حاوية ${formatNum(Math.min(shotProgress.done + 1, shotProgress.total), locale)} من 4 اتجاهات…`,
                )
              : txt(
                  "Every container photographed. The report is ready.",
                  "كل الحاويات اتصوّرت. التقرير جاهز.",
                )
          }
          done={shotProgress.done}
          total={shotProgress.total}
          state={reportStage === "SHOOTING" ? "RUNNING" : "DONE"}
          actionLabel={txt("Open", "افتح")}
          onAction={() => {
            setReportOpen(true);
          }}
          dismissLabel={txt("Dismiss", "اقفل")}
          onDismiss={() => {
            setReportStage("IDLE");
          }}
        />
      )}

      {reportOpen && plan !== null && unit !== undefined && (
        <Suspense fallback={null}>
          <CargoReportView
            plan={plan}
            unit={unit}
            containerName={fleetSummary(plan.units, nameOf)}
            nameOf={nameOf}
            shots={shots}
            colorOf={colorOf}
            captionOf={captionOf}
            boardsIn={boardsIn}
            reference={
              source === "QUOTATION" && quotationRef !== ""
                ? quotationRef
                : new Date().toLocaleDateString(ar ? "ar-EG" : "en-GB")
            }
            onClose={() => {
              setReportOpen(false);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
