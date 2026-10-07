import type { ThreeElements } from "@react-three/fiber";
declare module "react" {
  // React Three Fiber extends React's JSX element catalog at compile time.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}
import { useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  PackingResult,
  PackingUnit,
  Placement,
} from "../lib/cargo-packing.ts";
import { CargoLights, CargoLoad, SCENE_BACKGROUND } from "./CargoScene.tsx";
import { reportViews, type ViewName } from "../lib/cargo-report.ts";

/**
 * The four photographs of each container, taken in the browser.
 *
 * A customer standing at the back of a container needs a picture taken from
 * where they are standing, so the report carries one shot per side rather than
 * one pretty three-quarter view. The shots are taken by rendering the same
 * `CargoLoad` the screen draws — not a second copy of it — from the viewpoints
 * `cargo-report.ts` works out, and reading the canvas back as a PNG.
 *
 * It is done one container at a time, on purpose. Mounting every container at
 * once would hold every bundle of a ten-container shipment in memory before the
 * first picture is taken, and the progress a person watches would be a single
 * jump from nothing to done.
 */

export interface Shot {
  readonly unitIndex: number;
  readonly view: ViewName;
  readonly dataUrl: string;
}

const SHOT_WIDTH = 900;
const SHOT_HEIGHT = 520;

function Photographer({
  unit,
  onShots,
}: {
  unit: PackingUnit;
  onShots: (shots: { view: ViewName; dataUrl: string }[]) => void;
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const lens = camera as THREE.PerspectiveCamera;
    // Say what shape the picture is rather than inheriting it. The stage is a
    // hidden element, and a camera that takes its aspect from however that
    // element happened to be laid out framed the container square — which cut
    // both ends off every side view in the first report.
    lens.aspect = SHOT_WIDTH / SHOT_HEIGHT;
    const taken: { view: ViewName; dataUrl: string }[] = [];
    for (const view of reportViews(unit)) {
      // Up before lookAt: the orientation is worked out from whatever `up`
      // says at that moment, and a plan view left on the world's up has no
      // orientation at all — it is looking straight along it.
      lens.up.set(...view.up);
      lens.position.set(...view.position);
      lens.lookAt(new THREE.Vector3(...view.target));
      lens.updateProjectionMatrix();
      // Render by hand rather than waiting for a frame: the loop has to finish
      // before the canvas is read, and an animation frame would read whichever
      // view happened to be last.
      gl.render(scene, lens);
      taken.push({
        view: view.name,
        dataUrl: gl.domElement.toDataURL("image/png"),
      });
    }
    onShots(taken);
    // Once per mounted container; the parent remounts this for the next one,
    // so the empty dependency list is the whole point rather than an oversight.
  }, []);
  return null;
}

export interface ReportProgress {
  /** Containers photographed so far. */
  readonly done: number;
  readonly total: number;
}

/**
 * Photograph every container in a plan, one at a time, reporting progress.
 *
 * Nothing is visible: the canvas is a fixed size off the side of the page, so
 * the pictures are the same size whatever the window is, and taking them does
 * not move the screen the person is looking at.
 */
export function CargoPhotoStage({
  plan,
  unit,
  colorOf,
  captionOf,
  onProgress,
  onFinished,
}: {
  plan: PackingResult;
  unit: PackingUnit;
  colorOf: (itemId: string) => string;
  captionOf?: ((placement: Placement) => string) | undefined;
  onProgress: (progress: ReportProgress) => void;
  onFinished: (shots: Shot[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const loaded = plan.units[index];

  // Finished means there is no container left to mount. Watching that, rather
  // than the index, is what keeps a one-container plan from being announced
  // before its only picture is taken.
  const finished = loaded === undefined;
  useEffect(() => {
    if (finished) onFinished(shots);
  }, [finished, onFinished, shots]);

  if (loaded === undefined) return null;
  // Each container is photographed as the box it is: in a mixed plan the
  // twenty is not drawn as a forty.
  const box = loaded.unit ?? unit;
  return (
    <div className="cargo-photo-stage" aria-hidden="true">
      <Canvas
        key={index}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={2}
        camera={{ fov: 38 }}
        frameloop="demand"
        style={{ width: SHOT_WIDTH, height: SHOT_HEIGHT }}
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <CargoLights unit={box} />
        <CargoLoad
          loaded={loaded}
          unit={box}
          colorOf={colorOf}
          captionOf={captionOf}
        />
        <Photographer
          unit={box}
          onShots={(taken) => {
            setShots((current) => [
              ...current,
              ...taken.map((shot) => ({ ...shot, unitIndex: index })),
            ]);
            onProgress({ done: index + 1, total: plan.units.length });
            setIndex((current) => current + 1);
          }}
        />
      </Canvas>
    </div>
  );
}
