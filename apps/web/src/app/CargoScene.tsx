import type { ThreeElements } from "@react-three/fiber";
declare module "react" {
  // React Three Fiber extends React's JSX element catalog at compile time.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}
import { useEffect, useMemo, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";
import * as THREE from "three";
import type {
  LoadedUnit,
  PackingUnit,
  Placement,
} from "../lib/cargo-packing.ts";
import { labelFaces } from "../lib/cargo-labels.ts";
import { loadingOrder } from "../lib/cargo-demo.ts";
import type { LabelFace, LabelFacing } from "../lib/cargo-labels.ts";

/**
 * The load, drawn.
 *
 * The drawing exists to answer one question a table cannot: *does this look
 * like something a crew can actually load*. So the container is a cage rather
 * than a solid, every bundle keeps its real proportions, and the colours group
 * by product line — the same product is the same colour in every unit, which
 * is what makes an unbalanced load obvious at a glance.
 *
 * Each physical bundle also carries its description, printed on its faces the
 * way a banded bundle in the yard carries a tag, so the picture can be shown to a
 * customer or a driver without a legend beside it. `../lib/cargo-labels.ts`
 * decides where those markings go; this file draws them.
 *
 * Scene units are metres; the packer works in millimetres. The conversion
 * happens once, here, and the packer never learns about the camera.
 */

const MM = 0.001;

/**
 * Clear of the face it is printed on, so it never fights the box for pixels —
 * and no further, because the space just outside a face usually belongs to the
 * next bundle.
 */
const TAG_LIFT_M = 0.003;

/** The tag canvas is 1024 x 512, and the geometry has to fit that shape. */
const TAG_ASPECT = 2;

const TAG_FONT = `"IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif`;

/**
 * Can this browser draw at all?
 *
 * Mounting the canvas without asking throws an unhandled rejection from deep
 * inside three.js and takes the rest of the screen with it — which is what a
 * machine with no GPU, a locked-down browser or a remote session gets. The
 * plan does not need a graphics card; only the picture of it does, so the
 * question is asked first and the answer is a sentence rather than a crash.
 */
function canDrawIn3D(): boolean {
  try {
    const probe = document.createElement("canvas");
    const context =
      probe.getContext("webgl2") ??
      probe.getContext("webgl") ??
      probe.getContext("experimental-webgl");
    return context !== null;
  } catch {
    return false;
  }
}

/** A hex band, as numbers, so the engraving can be mixed from it. */
function channels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean,
    16,
  );
  if (Number.isNaN(value)) return [120, 120, 120];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Toward black at a negative amount, toward white at a positive one. */
function shift(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const by = Math.abs(amount);
  const [r, g, b] = channels(hex);
  const mix = (channel: number) =>
    Math.round(channel + (target - channel) * by);
  return `rgb(${String(mix(r))}, ${String(mix(g))}, ${String(mix(b))})`;
}

const NBSP = " ";

/**
 * Keep a measurement in one piece.
 *
 * "ACROW Board 15 mm x 1220 mm x 2440 mm" wrapped on plain spaces breaks as
 * "…15 mm x 1220 / mm x 2440 mm", which splits a dimension across two lines and
 * makes the reader reassemble it. Binding a number to its unit, and a separator
 * to the number after it, turns the size into three tokens that move together.
 */
function bindMeasurements(text: string): string {
  return text
    .replace(/(\d)\s+(mm|cm|m|kg|kgs)\b/gi, `$1${NBSP}$2`)
    .replace(/([x×*])\s+(?=[\d.])/gi, `$1${NBSP}`);
}

/** Break the description into the fewest lines that fit the given width. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  // Split on breaking whitespace only, spelled out: `\s` would undo the
  // binding above, because a non-breaking space is whitespace as far as it is
  // concerned.
  const words = bindMeasurements(text)
    .split(/[ \t\r\n]+/)
    .filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [text] : lines;
}

interface Tag {
  readonly texture: THREE.CanvasTexture;
}

/** One product's marking: what it says, and the band it is cut into. */
interface Marking {
  readonly key: string;
  readonly text: string;
  readonly band: string;
}

/**
 * The description, cut into the bundle.
 *
 * It is a 2-D canvas rather than 3-D text for two reasons that both decide it
 * here: the browser shapes Arabic correctly and the signed-distance-field text
 * libraries do not, and a canvas needs no typeface fetched from the internet,
 * which a factory network may not reach.
 *
 * Nothing is drawn behind the words. A plate would sit *on* the bundle; what a
 * marked bundle actually looks like is text cut *into* it, so each letter is
 * drawn three times — a dark edge up and left where the cut is in shadow, a
 * light edge down and right where it catches the light, and the recess itself
 * in a darker shade of the band. Mixing all three from the band is what keeps
 * every product's marking in that product's own colour.
 */
function drawTag(text: string, band: string): Tag {
  // Powers of two, and always the same two. WebGL1 renders a non-power-of-two
  // texture black once it has mipmaps, and a tag whose shape changed with its
  // wording would make one stack's marking bigger than its neighbour's for no
  // reason a reader could see.
  const height = 512;
  const width = height * TAG_ASPECT;
  const pad = 26;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Most of these faces are seen at an angle, which is exactly where a texture
  // without anisotropy turns to mud.
  texture.anisotropy = 8;
  const tag: Tag = { texture };

  const ctx = canvas.getContext("2d");
  if (ctx === null) return tag;

  // The whole description, at the largest size that still fits — the size is
  // found by trying, because how many lines it wraps to depends on the size.
  const room = { width: width - pad * 2, height: height - pad * 2 };
  let size = 132;
  let lines: string[] = [];
  for (; size > 26; size -= 4) {
    ctx.font = `700 ${String(size)}px ${TAG_FONT}`;
    lines = wrap(ctx, text, room.width);
    if (lines.length * size * 1.22 <= room.height) break;
  }

  const lineHeight = size * 1.22;
  // The recess is well below the band and the lit edge well above it. A cut
  // only a shade off its surface reads as a smudge on a screen, whatever it
  // would look like on real timber.
  const cut = shift(band, -0.72);
  const shadow = shift(band, -0.92);
  const lit = shift(band, 0.78);
  const relief = Math.max(2, Math.round(size / 22));

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${String(size)}px ${TAG_FONT}`;
  let top = (height - lines.length * lineHeight) / 2;
  for (const line of lines) {
    const middle = top + lineHeight / 2;
    ctx.fillStyle = lit;
    ctx.fillText(line, width / 2 + relief, middle + relief);
    ctx.fillStyle = shadow;
    ctx.fillText(line, width / 2 - relief, middle - relief);
    ctx.fillStyle = cut;
    ctx.fillText(line, width / 2, middle);
    top += lineHeight;
  }
  texture.needsUpdate = true;
  return tag;
}

/**
 * One tag per distinct marking, not per face: the same product cut into ten
 * faces is one canvas, and the GPU holds one texture for it. The band is part
 * of the key because the engraving is mixed from it.
 */
function useTags(markings: readonly Marking[]): Map<string, Tag> {
  const signature = JSON.stringify(markings);
  const tags = useMemo(() => {
    const made = new Map<string, Tag>();
    for (const marking of JSON.parse(signature) as Marking[]) {
      if (made.has(marking.key)) continue;
      made.set(marking.key, drawTag(marking.text, marking.band));
    }
    return made;
  }, [signature]);

  useEffect(
    () => () => {
      for (const tag of tags.values()) tag.texture.dispose();
    },
    [tags],
  );
  return tags;
}

/** Centres and turns a face so its text faces out of the stack. */
function faceTransform(face: LabelFace): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const x = face.centreXMm * MM;
  const y = face.centreZMm * MM;
  const z = face.centreYMm * MM;
  const quarter = Math.PI / 2;
  const turns: Record<
    LabelFacing,
    { position: [number, number, number]; rotation: [number, number, number] }
  > = {
    WIDTH_PLUS: { position: [x, y, z + TAG_LIFT_M], rotation: [0, 0, 0] },
    WIDTH_MINUS: {
      position: [x, y, z - TAG_LIFT_M],
      rotation: [0, Math.PI, 0],
    },
    LENGTH_PLUS: {
      position: [x + TAG_LIFT_M, y, z],
      rotation: [0, quarter, 0],
    },
    LENGTH_MINUS: {
      position: [x - TAG_LIFT_M, y, z],
      rotation: [0, -quarter, 0],
    },
    // Laid flat on the stack's top. A quarter turn about X and nothing else:
    // that leaves the words running along the container with their tops
    // pointing at one side wall, which is how you read a marking standing
    // beside the load. Adding a turn about Z as well stands the words on end.
    TOP: {
      position: [x, y + TAG_LIFT_M, z],
      rotation: [-quarter, 0, 0],
    },
  };
  return turns[face.facing];
}

/** A marking must never swallow a hover meant for the bundle it is cut into. */
const noRaycast = () => undefined;

function StackTag({
  face,
  tag,
  dim,
}: {
  face: LabelFace;
  tag: Tag;
  dim: boolean;
}) {
  // The fit was settled where the faces were chosen, because it is what decides
  // whether the next bundle along covers the marking.
  const { position, rotation } = faceTransform(face);
  return (
    <mesh position={position} rotation={rotation} raycast={noRaycast}>
      <planeGeometry args={[face.tagWidthMm * MM, face.tagHeightMm * MM]} />
      {/* Lambert, not basic: a cut in the surface is lit by the same lamps as
          the surface, and a marking that stayed bright on a shaded face would
          look stuck on rather than cut in. */}
      <meshLambertMaterial
        map={tag.texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        opacity={dim ? 0.14 : 1}
      />
    </mesh>
  );
}

function Bundle({
  placement,
  color,
  dim,
  onHover,
}: {
  placement: Placement;
  color: string;
  dim: boolean;
  onHover?: ((value: Placement | null) => void) | undefined;
}) {
  const l = placement.lengthMm * MM;
  const w = placement.widthMm * MM;
  const h = placement.heightMm * MM;
  return (
    <mesh
      position={[
        placement.x * MM + l / 2,
        placement.z * MM + h / 2,
        placement.y * MM + w / 2,
      ]}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover?.(placement);
      }}
      onPointerOut={() => {
        onHover?.(null);
      }}
    >
      <boxGeometry args={[l, h, w]} />
      <meshLambertMaterial
        color={color}
        transparent={dim}
        opacity={dim ? 0.25 : 1}
      />
      {/* Banding lines. Without an edge the stack reads as one solid block
          and you cannot count the bundles in it — but 400 loose boards at
          18 mm each put those lines a pixel apart, where hard black turns the
          stack into moire. A thin piece gets an edge drawn in its own colour
          instead, so the striation reads as boards rather than interference. */}
      <Edges threshold={15} color={h > 0.04 ? "#0b0d1c" : shift(color, -0.4)} />
    </mesh>
  );
}

/**
 * ACROW's mark, stencilled on the deck at the door end.
 *
 * On the deck rather than over the picture, because a watermark drawn in the
 * page would be missing from the two things the mark is most needed on: the
 * photographs in the client report, and the recorded demo. Both come off the
 * canvas, so anything that has to appear in them has to be in the scene.
 *
 * The door end is where the load finishes rather than starts, so it stays
 * visible through most of a demo, and it is the first thing in frame when the
 * report looks in through the doors.
 *
 * `useLoader` suspends, which is the behaviour wanted here: the report's
 * photographer is a sibling, and nothing should be photographed before the
 * mark has arrived.
 */
function DeckMark({ unit }: { unit: PackingUnit }) {
  const texture = useLoader(THREE.TextureLoader, "/acrow-logo-white.png");
  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const width = Math.min(w * 0.7, 1.7);
  const image = texture.image as { width: number; height: number };
  const height = width * (image.height / image.width);
  return (
    <mesh
      // Turned the same way as the markings on the bundles, so a plan view
      // reads the deck and the load in one direction rather than two.
      position={[l - width * 0.6, 0.002, w / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={noRaycast}
    >
      <planeGeometry args={[width, height]} />
      <meshLambertMaterial
        map={texture}
        transparent
        opacity={0.5}
        depthWrite={false}
      />
    </mesh>
  );
}

function ContainerCage({ unit }: { unit: PackingUnit }) {
  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const h = unit.innerHeightMm * MM;
  return (
    <group>
      {/* The floor is solid so the load has something to sit on visually. */}
      <mesh position={[l / 2, -0.01, w / 2]} receiveShadow>
        <boxGeometry args={[l, 0.02, w]} />
        <meshLambertMaterial color="#6b7280" />
      </mesh>
      <DeckMark unit={unit} />
      {/* The walls are an outline: a solid box would hide the load inside it. */}
      <mesh position={[l / 2, h / 2, w / 2]}>
        <boxGeometry args={[l, h, w]} />
        <meshBasicMaterial visible={false} />
        <Edges threshold={15} color="#9aa3b8" />
      </mesh>
    </group>
  );
}

const baseItemId = (itemId: string) => itemId.replace(/~rest$/, "");

/**
 * How far each bundle's own shade sits from its product's band.
 *
 * Every bundle gets a colour of its own so two stacked against each other are
 * two bundles and not one block — but the shades are all cut from the product's
 * band and all pulled towards black, so a product still reads as one colour
 * across the container. Six steps, so a stack of six is six distinct tones
 * before it repeats, and none of them goes light: the scene is dark and a pale
 * bundle flares under the lamps.
 */
const BUNDLE_SHADES = [0, -0.14, -0.28, -0.07, -0.21, -0.35] as const;

/**
 * The shade for each placement, by the order its own product goes in.
 *
 * Counted per product rather than across the load, so the first bundle of the
 * blue line is as bright as the first bundle of the red one.
 */
function shadesFor(
  placements: readonly Placement[],
  colorOf: (itemId: string) => string,
): string[] {
  const seen = new Map<string, number>();
  return placements.map((placement) => {
    const product = baseItemId(placement.itemId);
    const index = seen.get(product) ?? 0;
    seen.set(product, index + 1);
    const step = BUNDLE_SHADES[index % BUNDLE_SHADES.length] ?? 0;
    return shift(colorOf(placement.itemId), step);
  });
}

export interface CargoLoadProps {
  loaded: LoadedUnit;
  unit: PackingUnit;
  /** The band a bundle group is drawn in; the screen owns the palette. */
  colorOf: (itemId: string) => string;
  /**
   * What is cut into a stack. The screen owns the wording because the screen is
   * the side that knows the product; when it says nothing, the placement's own
   * description is used.
   */
  captionOf?: ((placement: Placement) => string) | undefined;
  highlightItemId?: string | null | undefined;
  onHover?: ((value: Placement | null) => void) | undefined;
  /**
   * How many pieces are in so far. Undefined means the load is finished, which
   * is every use but the demo.
   */
  revealed?: number | undefined;
}

/**
 * One container and everything in it, ready to be put in front of a camera.
 *
 * It is exported because the client report photographs the same load from four
 * sides, and a report drawn by a second copy of this code is a report that goes
 * out of step with the screen the day either one is changed.
 */
export function CargoLoad({
  loaded,
  unit,
  colorOf,
  captionOf,
  highlightItemId = null,
  onHover,
  revealed,
}: CargoLoadProps) {
  // Mid-demo the load is whatever is in so far, in the order a crew puts it
  // in. The markings follow: a stack half built carries a marking sized to
  // what is standing, not to what it will be.
  const placements = useMemo(() => {
    if (revealed === undefined) return loaded.placements;
    return loadingOrder(loaded).slice(0, Math.max(0, revealed));
  }, [loaded, revealed]);

  const faces = useMemo(
    () =>
      labelFaces(placements, {
        groupKey: baseItemId,
        onePerBundle: true,
        tagAspect: TAG_ASPECT,
        // A marking cut into a bundle takes more of it than a tag stuck on
        // one would: it carries the whole description now, not a headline.
        tagHeightShare: 0.6,
        tagWidthShare: 0.9,
      }),
    [placements],
  );

  // The band is half the identity of a marking, so it is half of its key: the
  // same words cut into two different products are two different engravings.
  const markingOf = (placement: Placement): Marking => {
    const band = colorOf(placement.itemId);
    const text =
      captionOf === undefined ? placement.label : captionOf(placement);
    return { key: `${band} ${text}`, text, band };
  };
  const tags = useTags(
    useMemo(
      () => faces.map((face) => markingOf(face.placement)),
      [faces, captionOf, colorOf],
    ),
  );

  // Worked out once for the whole load: a bundle's shade depends on how many
  // of its product went in before it, which a per-bundle lookup cannot know.
  const shades = useMemo(
    () => shadesFor(placements, colorOf),
    [placements, colorOf],
  );

  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const dimmed = (itemId: string) =>
    highlightItemId !== null && baseItemId(itemId) !== highlightItemId;

  return (
    <group position={[-l / 2, 0, -w / 2]}>
      <ContainerCage unit={unit} />
      {placements.map((placement, index) => (
        <Bundle
          key={`${placement.itemId}-${String(index)}`}
          placement={placement}
          color={shades[index] ?? colorOf(placement.itemId)}
          dim={dimmed(placement.itemId)}
          onHover={onHover}
        />
      ))}
      {faces.map((face) => {
        const tag = tags.get(markingOf(face.placement).key);
        if (tag === undefined) return null;
        return (
          <StackTag
            key={face.key}
            face={face}
            tag={tag}
            dim={dimmed(face.placement.itemId)}
          />
        );
      })}
    </group>
  );
}

/** The lamps, identical on the screen and in the report. */
export function CargoLights({ unit }: { unit: PackingUnit }) {
  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const h = unit.innerHeightMm * MM;
  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[l, h * 3, w * 2]} intensity={0.85} />
      <directionalLight position={[-l, h * 2, -w]} intensity={0.3} />
    </>
  );
}

export const SCENE_BACKGROUND = "#0f1117";

export default function CargoScene({
  loaded,
  unit,
  colorOf,
  captionOf,
  highlightItemId,
  revealed,
  emptyLabel,
  noGraphicsLabel,
}: {
  loaded: LoadedUnit | undefined;
  unit: PackingUnit;
  /** The band a bundle group is drawn in; the screen owns the palette. */
  colorOf: (itemId: string) => string;
  /**
   * What is cut into a stack. The screen owns the wording because the screen is
   * the side that knows the product; when it says nothing, the placement's own
   * description is used.
   */
  captionOf?: ((placement: Placement) => string) | undefined;
  highlightItemId: string | null;
  /** Pieces loaded so far, while the demo is playing. */
  revealed?: number | undefined;
  emptyLabel: string;
  noGraphicsLabel: string;
}) {
  const [hovered, setHovered] = useState<Placement | null>(null);
  const [supported] = useState(canDrawIn3D);

  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const h = unit.innerHeightMm * MM;

  // Far enough back to hold the longest unit, angled so length, width and
  // height are all legible at once rather than a face-on elevation.
  const camera = useMemo(
    () => ({
      // The cage is centred on X/Z but sits above the floor. Looking at the
      // origin aimed the camera below the load, leaving a large black field
      // under the container that looked like unused cargo space. Frame the
      // physical centre instead and move closer so the cage, not the canvas,
      // is what the planner reads first.
      position: [l * 0.88, h * 1.75, w * 2.75] as [number, number, number],
      fov: 34,
    }),
    [l, h, w],
  );

  if (loaded === undefined || loaded.placements.length === 0) {
    return <p className="cargo-scene-empty">{emptyLabel}</p>;
  }
  if (!supported) {
    return <p className="cargo-scene-empty">{noGraphicsLabel}</p>;
  }

  return (
    <div className="cargo-scene">
      <Canvas camera={camera} dpr={[1, 2]}>
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <CargoLights unit={unit} />
        <CargoLoad
          loaded={loaded}
          unit={unit}
          colorOf={colorOf}
          captionOf={captionOf}
          highlightItemId={highlightItemId}
          revealed={revealed}
          onHover={setHovered}
        />
        <OrbitControls
          makeDefault
          target={[0, h / 2, 0]}
          enablePan
          maxPolarAngle={Math.PI / 2.05}
          minDistance={Math.max(l, w) * 0.5}
          maxDistance={Math.max(l, w) * 4}
        />
      </Canvas>
      {hovered !== null && (
        <div className="cargo-scene-tip" role="status">
          <strong>{hovered.label}</strong>
          {/* A size is a left-to-right run whatever the screen's language:
              reordered, 2,440 × 1,220 × 625 becomes a different bundle. */}
          <span dir="ltr">
            {Math.round(hovered.lengthMm)} × {Math.round(hovered.widthMm)} ×{" "}
            {Math.round(hovered.heightMm)} mm
          </span>
          <span dir="ltr">{hovered.weightKg.toLocaleString("en")} kg</span>
        </div>
      )}
    </div>
  );
}
