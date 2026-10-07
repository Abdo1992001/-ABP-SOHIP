import { useEffect, useState, type CSSProperties } from "react";

/**
 * The one place the ABP mark is drawn.
 *
 * Before this, the wordmark was an <img src="/acrow-logo.png"> written out by
 * hand in each screen that wanted it, and the dark theme had no variant at
 * all: the approved artwork is navy and crimson, which on the dark sidebar
 * measured 1.2:1 against its background — invisible. Every surface now asks
 * this component for the mark and gets the variant that is right for the
 * ground it is being drawn on.
 *
 * Two assets, both the approved artwork:
 *   acrow-logo.png        the default, for light grounds
 *   acrow-logo-white.png  the monochrome white variant, for dark grounds,
 *                         made by replacing the ink while keeping the file's
 *                         own alpha channel, so the letterforms, the slash
 *                         through the A and every anti-aliased edge are
 *                         identical to the original.
 *
 * There is deliberately no third "mark only" wordmark crop: the artwork's red
 * underline runs the full width, so any crop would cut through it and stop
 * being the approved mark. The collapsed rail uses the separate square asset.
 */

export type LogoGround = "light" | "dark" | "auto";
export type LogoSize = "sm" | "md" | "lg";

/** Rendered heights. The width always follows the artwork's own 522:125. */
const HEIGHTS: Record<LogoSize, number> = { sm: 24, md: 30, lg: 44 };

const NATURAL_WIDTH = 522;
const NATURAL_HEIGHT = 125;

/**
 * The theme actually in effect, read from the attribute the shell sets rather
 * than from React state, so the auth screen — which renders outside the app's
 * providers — gets the right variant too.
 */
export function useResolvedTheme(): "light" | "dark" {
  const read = () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState<"light" | "dark">(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(read());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    setTheme(read());
    return () => {
      observer.disconnect();
    };
  }, []);
  return theme;
}

export function AbpLogo({
  ground = "auto",
  size = "md",
  decorative = false,
  className,
}: {
  /**
   * The ground this instance sits on. "auto" follows the page theme; pass an
   * explicit value where a surface keeps its own colour regardless of theme —
   * a permanently dark hero, say — because the page theme would otherwise
   * pick the wrong variant for that one component.
   */
  ground?: LogoGround;
  size?: LogoSize;
  /** True where the name is already written beside it, so it is not read twice. */
  decorative?: boolean;
  className?: string;
}) {
  const theme = useResolvedTheme();
  const resolved = ground === "auto" ? theme : ground;
  const height = HEIGHTS[size];
  return (
    <img
      data-testid="abp-logo"
      className={className ? `abp-logo ${className}` : "abp-logo"}
      src={resolved === "dark" ? "/acrow-logo-white.png" : "/acrow-logo.png"}
      alt={decorative ? "" : "ACROW Building Products"}
      {...(decorative ? { "aria-hidden": true } : {})}
      width={NATURAL_WIDTH}
      height={NATURAL_HEIGHT}
      style={{ "--abp-logo-height": `${String(height)}px` } as CSSProperties}
    />
  );
}
