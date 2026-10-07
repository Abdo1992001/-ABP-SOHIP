import { useEffect, useMemo, useRef, useState } from "react";
import { codeOptions } from "../lib/product-lookup.ts";
import type { CodeQuery, LookupProduct } from "../lib/product-lookup.ts";

/**
 * Choosing which of the catalogue's codes this line means.
 *
 * The product master holds thirty-one items at 18 x 1220 x 2440, differing by
 * crust, logo, family or colour. "The code for an 18 mm board" therefore has
 * thirty-one answers, and a system that picks one is a system that quotes the
 * wrong variant — priced, sent and delivered before anybody notices.
 *
 * So the line's size finds the candidates and a person chooses between them.
 * The whole description is shown for each, because the difference between two
 * codes is always at the end of it, and the search box narrows on the words or
 * on the code, because a salesperson arrives with either.
 */

export function ItemCodePicker({
  query,
  products,
  labels,
  onPick,
  onClose,
}: {
  query: CodeQuery;
  products: readonly LookupProduct[];
  labels: {
    title: string;
    search: string;
    empty: string;
    noSize: string;
    close: string;
    use: string;
    counted: (shown: number) => string;
  };
  onPick: (product: LookupProduct, code: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement | null>(null);

  const options = useMemo(
    () => codeOptions(query, products, filter),
    [query, products, filter],
  );
  // Without the size there is nothing to match on, and a picker that silently
  // lists nothing reads as a broken picker rather than a missing dimension.
  const hasSize =
    query.thicknessMm !== undefined &&
    query.widthMm !== undefined &&
    query.lengthMm !== undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    box.current?.querySelector("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="code-picker-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="code-picker"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        ref={box}
      >
        <div className="code-picker-head">
          <strong>{labels.title}</strong>
          <button
            type="button"
            className="code-picker-close"
            onClick={onClose}
            aria-label={labels.close}
          >
            ×
          </button>
        </div>

        <input
          className="code-picker-search"
          value={filter}
          placeholder={labels.search}
          aria-label={labels.search}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />

        <p className="code-picker-count">
          {hasSize ? labels.counted(options.length) : labels.noSize}
        </p>

        {options.length === 0 ? (
          <p className="code-picker-empty">{labels.empty}</p>
        ) : (
          <ul className="code-picker-list">
            {options.map((option) => (
              <li key={option.product.productId}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(option.product, option.code);
                  }}
                >
                  <code>{option.code}</code>
                  <span>{option.product.canonicalDescription}</span>
                  <em>{labels.use}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
