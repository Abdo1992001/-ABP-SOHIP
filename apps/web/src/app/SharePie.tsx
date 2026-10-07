import { useId, useMemo, useState } from "react";
import { SlideOver } from "./CommercialUI.tsx";

/**
 * A share-of-value donut: the top few slices by name, everything else pooled
 * into one, and the full ranked table one click away.
 *
 * A list of six rows answers "who is biggest". It does not answer "how much of
 * our business is that", which is the question a share chart exists for — and
 * it silently hides the other ninety-odd customers. The donut shows the shape;
 * expanding shows every row the endpoint returned, ranked, with its share.
 *
 * Drawn as plain SVG arcs rather than a charting library: this is one ring, it
 * has to match the app's own tokens in both themes, and pulling in a chart
 * dependency for it would cost more than it saves.
 */

export interface ShareSlice {
  key: string;
  label: string;
  value: number;
  /** Optional trailing note on the row, e.g. a group-company chip. */
  note?: string | undefined;
  href?: string | undefined;
}

/* Deterministic and distinct: the same customer keeps the same colour across
   renders, and neighbouring slices never collide. Tokens rather than fixed
   hex, because the previous values were picked for a light card -- #1b1560 is
   near-black navy -- and the biggest slice disappeared into the dark theme. */
const SLICE_COLORS = [
  "var(--slice-0)",
  "var(--slice-1)",
  "var(--slice-2)",
  "var(--slice-3)",
  "var(--slice-4)",
  "var(--slice-5)",
];

const TAU = Math.PI * 2;

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
): string {
  // A slice covering the whole ring has no start/end to draw between, so it is
  // rendered as two half arcs; otherwise the path collapses to nothing.
  const sweep = to - from;
  if (sweep >= TAU - 1e-9) {
    const half = from + Math.PI;
    return (
      `M ${String(cx + outer * Math.cos(from))} ${String(cy + outer * Math.sin(from))}` +
      ` A ${String(outer)} ${String(outer)} 0 1 1 ${String(cx + outer * Math.cos(half))} ${String(cy + outer * Math.sin(half))}` +
      ` A ${String(outer)} ${String(outer)} 0 1 1 ${String(cx + outer * Math.cos(from))} ${String(cy + outer * Math.sin(from))}` +
      ` M ${String(cx + inner * Math.cos(from))} ${String(cy + inner * Math.sin(from))}` +
      ` A ${String(inner)} ${String(inner)} 0 1 0 ${String(cx + inner * Math.cos(half))} ${String(cy + inner * Math.sin(half))}` +
      ` A ${String(inner)} ${String(inner)} 0 1 0 ${String(cx + inner * Math.cos(from))} ${String(cy + inner * Math.sin(from))} Z`
    );
  }
  const large = sweep > Math.PI ? 1 : 0;
  const x1 = cx + outer * Math.cos(from);
  const y1 = cy + outer * Math.sin(from);
  const x2 = cx + outer * Math.cos(to);
  const y2 = cy + outer * Math.sin(to);
  const x3 = cx + inner * Math.cos(to);
  const y3 = cy + inner * Math.sin(to);
  const x4 = cx + inner * Math.cos(from);
  const y4 = cy + inner * Math.sin(from);
  return (
    `M ${String(x1)} ${String(y1)}` +
    ` A ${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${String(x2)} ${String(y2)}` +
    ` L ${String(x3)} ${String(y3)}` +
    ` A ${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${String(x4)} ${String(y4)} Z`
  );
}

export function SharePie({
  title,
  slices,
  topCount = 5,
  formatValue,
  locale,
  emptyLabel,
}: {
  title: string;
  slices: readonly ShareSlice[];
  topCount?: number;
  formatValue: (value: number) => string;
  locale: string;
  emptyLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ShareSlice | null>(null);
  const titleId = useId();

  const model = useMemo(() => {
    const ranked = [...slices]
      .filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = ranked.reduce((sum, slice) => sum + slice.value, 0);
    const head = ranked.slice(0, topCount);
    const tail = ranked.slice(topCount);
    const tailValue = tail.reduce((sum, slice) => sum + slice.value, 0);
    return { ranked, total, head, tail, tailValue };
  }, [slices, topCount]);

  if (model.total <= 0) {
    return (
      <section className="share-pie">
        <h4>{title}</h4>
        <p className="share-pie-empty">{emptyLabel}</p>
      </section>
    );
  }

  const drawn = [
    ...model.head,
    ...(model.tailValue > 0
      ? [
          {
            key: "__others__",
            label:
              locale === "ar"
                ? `باقي الـ ${String(model.tail.length)}`
                : `Other ${String(model.tail.length)}`,
            value: model.tailValue,
          } satisfies ShareSlice,
        ]
      : []),
  ];

  let cursor = -Math.PI / 2;
  const arcs = drawn.map((slice, index) => {
    const from = cursor;
    const to = from + (slice.value / model.total) * TAU;
    cursor = to;
    return {
      slice,
      path: arcPath(60, 60, 56, 33, from, to),
      color: SLICE_COLORS[index % SLICE_COLORS.length] ?? SLICE_COLORS[0],
      pct: (slice.value / model.total) * 100,
    };
  });

  const canExpand = model.ranked.length > drawn.length || model.tail.length > 0;

  return (
    <section className="share-pie" aria-labelledby={titleId}>
      <header className="share-pie-head">
        <h4 id={titleId}>{title}</h4>
        {canExpand && (
          <button
            type="button"
            className="share-pie-toggle"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            {locale === "ar"
              ? `عرض الكل (${String(model.ranked.length)})`
              : `Show all (${String(model.ranked.length)})`}
          </button>
        )}
      </header>

      <div className="share-pie-body">
        <svg
          className="share-pie-svg"
          viewBox="0 0 120 120"
          role="img"
          aria-label={`${title}: ${arcs
            .map((arc) => `${arc.slice.label} ${arc.pct.toFixed(0)}%`)
            .join(", ")}`}
        >
          {arcs.map((arc) => (
            <path
              key={arc.slice.key}
              d={arc.path}
              fill={arc.color}
              className="share-pie-arc"
              onClick={() => {
                setDetail(arc.slice);
              }}
            >
              <title>{`${arc.slice.label} — ${formatValue(arc.slice.value)} (${arc.pct.toFixed(1)}%)`}</title>
            </path>
          ))}
          <text className="share-pie-centre" x="60" y="57">
            {String(model.ranked.length)}
          </text>
          <text className="share-pie-centre-sub" x="60" y="72">
            {locale === "ar" ? "إجمالي" : "total"}
          </text>
        </svg>

        <ul className="share-pie-legend">
          {arcs.map((arc) => (
            <li key={arc.slice.key}>
              <span
                className="share-pie-dot"
                style={{ background: arc.color }}
                aria-hidden="true"
              />
              {/* Clicking a slice opens its detail rather than navigating
                  away: the reader is comparing shares, and losing the chart to
                  answer "what is that one" is the wrong trade. */}
              <button
                type="button"
                className="share-pie-name share-pie-rowbtn"
                onClick={() => {
                  setDetail(arc.slice);
                }}
              >
                {arc.slice.label}
                {arc.slice.note && (
                  <em className="share-pie-note">{arc.slice.note}</em>
                )}
              </button>
              <span className="share-pie-pct">{arc.pct.toFixed(1)}%</span>
              <strong className="share-pie-value">
                {formatValue(arc.slice.value)}
              </strong>
            </li>
          ))}
        </ul>
      </div>

      {expanded && (
        <SlideOver
          variant="centre"
          width={720}
          title={`${title} — ${String(model.ranked.length)}`}
          onClose={() => {
            setExpanded(false);
          }}
        >
          <table className="share-pie-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{locale === "ar" ? "الاسم" : "Name"}</th>
                <th>{locale === "ar" ? "النسبة" : "Share"}</th>
                <th>{locale === "ar" ? "القيمة" : "Value"}</th>
              </tr>
            </thead>
            <tbody>
              {model.ranked.map((slice, index) => (
                <tr key={slice.key}>
                  <td>{index + 1}</td>
                  <td>
                    <button
                      type="button"
                      className="share-pie-rowbtn"
                      onClick={() => {
                        setDetail(slice);
                      }}
                    >
                      {slice.label}
                    </button>
                    {slice.note && (
                      <em className="share-pie-note">{slice.note}</em>
                    )}
                  </td>
                  <td>{((slice.value / model.total) * 100).toFixed(2)}%</td>
                  <td>{formatValue(slice.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SlideOver>
      )}

      {detail && (
        <SlideOver
          variant="centre"
          width={480}
          title={detail.label}
          onClose={() => {
            setDetail(null);
          }}
        >
          <dl className="share-pie-detail">
            <div>
              <dt>{locale === "ar" ? "القيمة" : "Value"}</dt>
              <dd>{formatValue(detail.value)}</dd>
            </div>
            <div>
              <dt>
                {locale === "ar" ? "النسبة من الإجمالي" : "Share of total"}
              </dt>
              <dd>{((detail.value / model.total) * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "الترتيب" : "Rank"}</dt>
              <dd>
                {String(
                  model.ranked.findIndex((row) => row.key === detail.key) + 1,
                )}{" "}
                / {String(model.ranked.length)}
              </dd>
            </div>
            {detail.note && (
              <div>
                <dt>{locale === "ar" ? "النوع" : "Relationship"}</dt>
                <dd>{detail.note}</dd>
              </div>
            )}
          </dl>
          {detail.href && (
            <a className="share-pie-detail-link" href={detail.href}>
              {locale === "ar"
                ? "افتح السجل الكامل →"
                : "Open the full record →"}
            </a>
          )}
        </SlideOver>
      )}
    </section>
  );
}
