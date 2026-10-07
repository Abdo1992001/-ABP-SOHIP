import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { commercialRequest, isObject } from "./commercial-api.ts";
import { ErrorBanner, PageHeader, useToast } from "./CommercialUI.tsx";
import { MapPinSheet } from "./MapPinSheet.tsx";

/**
 * Who we deal with, and where.
 *
 * Going to a site in the Fifth Settlement, a salesperson wants to know which
 * of our customers and projects are around it, who the contractors are, and
 * how much business each one is. Every customer and project is placed by its
 * pin, else by the district or city in its address, else by its country --
 * and the map says which, so an approximate dot is never mistaken for an
 * address.
 */

type Rec = Record<string, unknown>;
type Point = Rec & {
  lat: number;
  lng: number;
  kind: "ACCOUNT" | "PROJECT";
  id: string;
};
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const EGYPT: L.LatLngBoundsExpression = [
  [22.0, 24.7],
  [31.7, 36.9],
];
const RADII = [5, 10, 25, 50];
const ROLE: Record<string, { en: string; ar: string }> = {
  MAIN_CONTRACTOR: { en: "Main contractor", ar: "مقاول رئيسي" },
  SUBCONTRACTOR: { en: "Subcontractor", ar: "مقاول باطن" },
  DEVELOPER: { en: "Developer", ar: "مطوّر" },
  OWNER: { en: "Owner", ar: "المالك" },
  CONSULTANT: { en: "Consultant", ar: "استشاري" },
};
const PRECISION: Record<string, { en: string; ar: string }> = {
  PINNED: { en: "Pinned", ar: "متحدد بالظبط" },
  DISTRICT: { en: "By district", ar: "بالحي" },
  VIA_PROJECT: { en: "Via its project", ar: "من مشروعه" },
  COUNTRY: { en: "Country only", ar: "الدولة بس" },
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "1,560,000 EGP · 12,000 USD" from a currency → amount map. */
function moneyText(value: unknown, locale: "en" | "ar"): string {
  if (!isObject(value)) return "—";
  const parts = Object.entries(value)
    .filter(([, amount]) => Number(amount) > 0)
    .map(
      ([currency, amount]) =>
        `${formatNum(Number(amount), locale)} ${currency}`,
    );
  return parts.length === 0 ? "—" : parts.join(" · ");
}
function size(value: unknown): number {
  if (!isObject(value)) return 0;
  return Object.values(value).reduce<number>(
    (sum, amount) => sum + (Number(amount) || 0),
    0,
  );
}

export function CustomerMapPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const cache = useQueryClient();
  const toast = useToast();
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const focusLayer = useRef<L.LayerGroup | null>(null);
  const [view, setView] = useState<"EGYPT" | "WORLD">("EGYPT");
  const [showAccounts, setShowAccounts] = useState(true);
  const [showProjects, setShowProjects] = useState(true);
  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [radius, setRadius] = useState(10);
  const [query, setQuery] = useState("");
  const [pinning, setPinning] = useState<Point | null>(null);

  const places = useQuery({
    queryKey: ["map-places"],
    queryFn: async () => {
      const result = await commercialRequest(client, "GET", "/map/places", {
        path: {},
      });
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const data = places.data ?? {};
  const accounts = useMemo(
    () =>
      Array.isArray(data.accounts)
        ? (data.accounts.filter(isObject) as Point[])
        : [],
    [data.accounts],
  );
  const projects = useMemo(
    () =>
      Array.isArray(data.projects)
        ? (data.projects.filter(isObject) as Point[])
        : [],
    [data.projects],
  );
  const areas = useMemo(
    () => (Array.isArray(data.places) ? data.places.filter(isObject) : []),
    [data.places],
  );

  const pin = useMutation({
    mutationFn: (input: {
      point: Point;
      lat: number | null;
      lng: number | null;
    }) =>
      commercialRequest(client, "PUT", "/map/locations", {
        path: {},
        body: {
          resourceTypeCode: input.point.kind,
          resourceId: input.point.id,
          latitude: input.lat,
          longitude: input.lng,
        },
      }),
    onSuccess: async () => {
      setPinning(null);
      await cache.invalidateQueries({ queryKey: ["map-places"] });
      toast.success(txt("Location saved", "اتحفظ المكان"));
    },
  });

  // The map itself, created once.
  useEffect(() => {
    if (!mapNode.current || map.current) return;
    const created = L.map(mapNode.current, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    // Esri's light grey canvas and its labels: calm under the dots, free
    // without a key. The app sends no referrer by policy; tile requests send
    // the origin only, which the tile service needs.
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
    L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      attribution:
        "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
      maxZoom: 16,
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(created);
    L.tileLayer(
      `${esri}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      {
        maxZoom: 16,
        referrerPolicy: "strict-origin-when-cross-origin",
      },
    ).addTo(created);
    created.fitBounds(EGYPT);
    layer.current = L.layerGroup().addTo(created);
    focusLayer.current = L.layerGroup().addTo(created);
    map.current = created;
    return () => {
      created.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    if (view === "WORLD") map.current.flyTo([25, 20], 2, { duration: 0.8 });
    else map.current.flyToBounds(EGYPT, { duration: 0.8 });
  }, [view]);

  // A click while pinning puts the record exactly there.
  useEffect(() => {
    const current = map.current;
    if (!current) return;
    const onClick = (event: L.LeafletMouseEvent) => {
      if (pinning)
        pin.mutate({
          point: pinning,
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        });
    };
    current.on("click", onClick);
    current.getContainer().style.cursor = pinning ? "crosshair" : "";
    return () => {
      current.off("click", onClick);
    };
  }, [pinning, pin]);

  // Markers.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const largest = Math.max(
      1,
      ...accounts.map((one) => size(one.orderedValue) + size(one.quotedValue)),
      ...projects.map((one) => size(one.quotedValue)),
    );
    const draw = (point: Point) => {
      const value =
        point.kind === "ACCOUNT"
          ? size(point.orderedValue) + size(point.quotedValue)
          : size(point.quotedValue);
      const approximate =
        point.precision === "COUNTRY" || point.precision === "VIA_PROJECT";
      const radiusPx = 7 + Math.sqrt(value / largest) * 16;
      const colour = point.kind === "ACCOUNT" ? "#1b2a6b" : "#c81d25";
      const marker = L.circleMarker([point.lat, point.lng], {
        radius: radiusPx,
        color: colour,
        weight: 2,
        fillColor: colour,
        fillOpacity: approximate ? 0.12 : 0.55,
        dashArray: approximate ? "4 3" : undefined,
      });
      const lines =
        point.kind === "ACCOUNT"
          ? [
              `<strong>${escape(text(point.name))}</strong>`,
              ...(Array.isArray(point.roles) && point.roles.length > 0
                ? [
                    point.roles
                      .map(
                        (role) =>
                          (ar ? ROLE[text(role)]?.ar : ROLE[text(role)]?.en) ??
                          text(role),
                      )
                      .join(" · "),
                  ]
                : []),
              `${txt("Ordered", "أوردرات")}: ${escape(moneyText(point.orderedValue, locale))}`,
              `${txt("Quoted", "عروض أسعار")}: ${escape(moneyText(point.quotedValue, locale))}`,
              `${txt("Salesperson", "المندوب")}: ${escape(text(point.ownerName) || "—")}`,
              `<a href="/customers/${point.id}">${txt("Open customer", "افتح العميل")} →</a>`,
            ]
          : [
              `<strong>${escape(text(point.name))}</strong>`,
              escape(
                [text(point.city), text(point.region)]
                  .filter(Boolean)
                  .join(", "),
              ),
              ...(Array.isArray(point.parties)
                ? point.parties
                    .filter(isObject)
                    .map(
                      (party) =>
                        `${escape(text(party.accountName))} — ${(ar ? ROLE[text(party.roleCode)]?.ar : ROLE[text(party.roleCode)]?.en) ?? text(party.roleCode)}`,
                    )
                : []),
              `${txt("Quoted", "عروض أسعار")}: ${escape(moneyText(point.quotedValue, locale))}`,
              `<a href="/projects/${point.id}">${txt("Open project", "افتح المشروع")} →</a>`,
            ];
      lines.push(
        `<em>${(ar ? PRECISION[text(point.precision)]?.ar : PRECISION[text(point.precision)]?.en) ?? ""}</em>`,
      );
      marker.bindPopup(`<div class="map-popup">${lines.join("<br/>")}</div>`);
      marker.addTo(group);
    };
    if (showProjects) projects.forEach(draw);
    if (showAccounts) accounts.forEach(draw);
  }, [accounts, projects, showAccounts, showProjects, ar, locale]);

  // The circle around the area being looked at.
  useEffect(() => {
    const group = focusLayer.current;
    if (!group) return;
    group.clearLayers();
    if (!focus) return;
    L.circle([focus.lat, focus.lng], {
      radius: radius * 1000,
      color: "#c81d25",
      weight: 1.5,
      fillOpacity: 0.05,
      dashArray: "6 4",
    }).addTo(group);
    map.current?.flyTo(
      [focus.lat, focus.lng],
      radius <= 5 ? 13 : radius <= 10 ? 12 : radius <= 25 ? 11 : 9,
      { duration: 0.8 },
    );
  }, [focus, radius]);

  const near = useMemo(() => {
    if (!focus) return null;
    const within = <T extends Point>(rows: T[]) =>
      rows
        .filter((row) => row.precision !== "COUNTRY")
        .map((row) => ({ row, distance: km(focus, row) }))
        .filter((one) => one.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    return { accounts: within(accounts), projects: within(projects) };
  }, [focus, radius, accounts, projects]);

  // Where we work, by district, when no area is chosen.
  const byArea = useMemo(() => {
    const counts = new Map<
      string,
      {
        label: string;
        lat: number;
        lng: number;
        accounts: number;
        projects: number;
      }
    >();
    for (const point of [...accounts, ...projects]) {
      const key = text(point.placeKey);
      if (!key) continue;
      const area = areas.find((one) => one.key === key);
      if (!area) continue;
      const entry = counts.get(key) ?? {
        label: ar ? text(area.ar) : text(area.en),
        lat: Number(area.lat),
        lng: Number(area.lng),
        accounts: 0,
        projects: 0,
      };
      if (point.kind === "ACCOUNT") entry.accounts += 1;
      else entry.projects += 1;
      counts.set(key, entry);
    }
    return [...counts.values()].sort(
      (a, b) => b.accounts + b.projects - (a.accounts + a.projects),
    );
  }, [accounts, projects, areas, ar]);

  const goTo = (value: string) => {
    const wanted = value.trim().toLowerCase();
    const area = areas.find(
      (one) =>
        text(one.en).toLowerCase() === wanted ||
        text(one.ar) === value.trim() ||
        text(one.key) === wanted,
    );
    if (area) {
      setView("EGYPT");
      setFocus({
        lat: Number(area.lat),
        lng: Number(area.lng),
        label: ar ? text(area.ar) : text(area.en),
      });
    }
  };
  const approximateCount = [...accounts, ...projects].filter(
    (point) =>
      point.precision === "COUNTRY" || point.precision === "VIA_PROJECT",
  ).length;

  return (
    <section className="workspace-page map-page">
      <PageHeader
        kicker={txt("Customers", "العملاء")}
        title={txt("Customer map", "خريطة العملاء")}
        status={txt(
          `${String(accounts.length)} customers · ${String(projects.length)} projects`,
          `${String(accounts.length)} عميل · ${String(projects.length)} مشروع`,
        )}
      />
      <div className="map-toolbar">
        <div
          className="map-segment"
          role="group"
          aria-label={txt("View", "العرض")}
        >
          {(["EGYPT", "WORLD"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={view === option ? "is-active" : ""}
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
                if (option === "WORLD") setFocus(null);
              }}
            >
              {option === "EGYPT"
                ? txt("Egypt", "مصر")
                : txt("World", "العالم")}
            </button>
          ))}
        </div>
        <label className="map-toggle map-toggle-account">
          <input
            type="checkbox"
            checked={showAccounts}
            onChange={() => {
              setShowAccounts(!showAccounts);
            }}
          />
          {txt("Customers", "العملاء")}
        </label>
        <label className="map-toggle map-toggle-project">
          <input
            type="checkbox"
            checked={showProjects}
            onChange={() => {
              setShowProjects(!showProjects);
            }}
          />
          {txt("Projects", "المشاريع")}
        </label>
        <form
          className="map-goto"
          onSubmit={(event) => {
            event.preventDefault();
            goTo(query);
          }}
        >
          <input
            list="map-areas"
            value={query}
            placeholder={txt(
              "Go to an area — e.g. Fifth Settlement",
              "روح لمنطقة — مثلًا التجمع الخامس",
            )}
            aria-label={txt("Go to an area", "روح لمنطقة")}
            onChange={(event) => {
              setQuery(event.target.value);
              goTo(event.target.value);
            }}
          />
          <datalist id="map-areas">
            {areas.map((area) => (
              <option
                key={text(area.key)}
                value={ar ? text(area.ar) : text(area.en)}
              >
                {ar ? text(area.en) : text(area.ar)}
              </option>
            ))}
          </datalist>
          <select
            value={radius}
            aria-label={txt("Within", "في نطاق")}
            onChange={(event) => {
              setRadius(Number(event.target.value));
            }}
          >
            {RADII.map((value) => (
              <option key={value} value={value}>
                {txt(
                  `within ${String(value)} km`,
                  `في نطاق ${String(value)} كم`,
                )}
              </option>
            ))}
          </select>
        </form>
      </div>
      <ErrorBanner
        error={places.error ?? pin.error}
        retry={() => void places.refetch()}
      />
      {pinning && (
        <p className="map-pinning">
          {txt("Click on the map where", "دوس على الخريطة في مكان")}{" "}
          <strong>{text(pinning.name)}</strong> {txt("is.", ".")}{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setPinning(null);
            }}
          >
            {txt("Cancel", "إلغاء")}
          </button>
        </p>
      )}
      <div className="map-layout">
        <div
          className="map-canvas panel"
          ref={mapNode}
          aria-label={txt("Map", "الخريطة")}
        />
        <aside className="map-side panel">
          {near && focus ? (
            <>
              <header className="map-side-head">
                <div>
                  <h2>{focus.label}</h2>
                  <span>
                    {txt(
                      `Within ${String(radius)} km`,
                      `في نطاق ${String(radius)} كم`,
                    )}{" "}
                    · {near.accounts.length} {txt("customers", "عميل")} ·{" "}
                    {near.projects.length} {txt("projects", "مشروع")}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setFocus(null);
                    setQuery("");
                  }}
                >
                  ×
                </button>
              </header>
              {near.projects.length > 0 && (
                <h3>{txt("Projects", "المشاريع")}</h3>
              )}
              <ul className="map-list">
                {near.projects.map(({ row, distance }) => (
                  <li key={row.id}>
                    <Link to={`/projects/${row.id}`}>{text(row.name)}</Link>
                    <span>
                      {formatNum(distance, locale, {
                        maximumFractionDigits: 1,
                      })}{" "}
                      {txt("km", "كم")}
                      {text(row.stageCode) && ` · ${text(row.stageCode)}`}
                    </span>
                    {Array.isArray(row.parties) &&
                      row.parties.filter(isObject).map((party) => (
                        <small key={text(party.accountId)}>
                          <Link to={`/customers/${text(party.accountId)}`}>
                            {text(party.accountName)}
                          </Link>{" "}
                          —{" "}
                          {(ar
                            ? ROLE[text(party.roleCode)]?.ar
                            : ROLE[text(party.roleCode)]?.en) ??
                            text(party.roleCode)}
                        </small>
                      ))}
                    <strong>{moneyText(row.quotedValue, locale)}</strong>
                  </li>
                ))}
              </ul>
              {near.accounts.length > 0 && (
                <h3>{txt("Customers", "العملاء")}</h3>
              )}
              <ul className="map-list">
                {near.accounts.map(({ row, distance }) => (
                  <li key={row.id}>
                    <Link to={`/customers/${row.id}`}>{text(row.name)}</Link>
                    <span>
                      {formatNum(distance, locale, {
                        maximumFractionDigits: 1,
                      })}{" "}
                      {txt("km", "كم")} · {text(row.ownerName) || "—"}
                    </span>
                    <small>
                      {txt("Ordered", "أوردرات")}:{" "}
                      {moneyText(row.orderedValue, locale)}
                    </small>
                    <small>
                      {txt("Quoted", "عروض أسعار")}:{" "}
                      {moneyText(row.quotedValue, locale)}
                    </small>
                  </li>
                ))}
              </ul>
              {near.accounts.length + near.projects.length === 0 && (
                <p className="empty-inline">
                  {txt(
                    "Nothing we deal with is placed in this area yet.",
                    "مفيش حد بنتعامل معاه متحدد في المنطقة دي لسه.",
                  )}
                </p>
              )}
            </>
          ) : (
            <>
              <h2>{txt("Where we work", "إحنا شغالين فين")}</h2>
              <ul className="map-areas">
                {byArea.map((area) => (
                  <li key={area.label}>
                    <button
                      type="button"
                      onClick={() => {
                        setFocus({
                          lat: area.lat,
                          lng: area.lng,
                          label: area.label,
                        });
                      }}
                    >
                      <strong>{area.label}</strong>
                      <span>
                        {area.accounts} {txt("customers", "عميل")} ·{" "}
                        {area.projects} {txt("projects", "مشروع")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {approximateCount > 0 && (
                <p className="settings-hint">
                  {txt(
                    `${String(approximateCount)} are placed only by country or by their project (hollow dots). Pin them to put them where they really are.`,
                    `${String(approximateCount)} متحددين بالدولة أو بالمشروع بس (النقط الفاضية). ثبّت مكانهم الحقيقي.`,
                  )}
                </p>
              )}
              {(data.canPinAccounts === true ||
                data.canPinProjects === true) && (
                <PinPicker
                  accounts={data.canPinAccounts === true ? accounts : []}
                  projects={data.canPinProjects === true ? projects : []}
                  onPick={(point) => {
                    setPinning(point);
                    toast.info(
                      txt("Now click on the map", "دوس على الخريطة دلوقتي"),
                    );
                  }}
                />
              )}
              {(data.canPinAccounts === true ||
                data.canPinProjects === true) && (
                <MapPinSheet
                  client={client}
                  points={[
                    ...(data.canPinAccounts === true ? accounts : []),
                    ...(data.canPinProjects === true ? projects : []),
                  ]}
                  onSaved={async (count) => {
                    await cache.invalidateQueries({ queryKey: ["map-places"] });
                    if (count > 0)
                      toast.success(
                        txt(
                          `${String(count)} places pinned`,
                          `${String(count)} مكان اتثبت`,
                        ),
                      );
                  }}
                />
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function PinPicker({
  accounts,
  projects,
  onPick,
}: {
  accounts: Point[];
  projects: Point[];
  onPick: (point: Point) => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [chosen, setChosen] = useState("");
  const all = [...projects, ...accounts];
  return (
    <div className="map-pin-picker">
      <h3>{txt("Pin a place", "ثبّت مكان")}</h3>
      <select
        value={chosen}
        onChange={(event) => {
          setChosen(event.target.value);
        }}
        aria-label={txt("Customer or project", "عميل أو مشروع")}
      >
        <option value="">
          {txt("Choose a customer or project…", "اختار عميل أو مشروع…")}
        </option>
        {all.map((point) => (
          <option
            key={`${point.kind}-${point.id}`}
            value={`${point.kind}-${point.id}`}
          >
            {point.kind === "PROJECT" ? "▣ " : "● "}
            {text(point.name)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={chosen === ""}
        onClick={() => {
          const point = all.find((one) => `${one.kind}-${one.id}` === chosen);
          if (point) onPick(point);
        }}
      >
        {txt("Pin on the map", "ثبّت على الخريطة")}
      </button>
    </div>
  );
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => `&#${String(char.charCodeAt(0))};`,
  );
}
