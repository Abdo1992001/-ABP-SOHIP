import type { ThreeElements } from "@react-three/fiber";
declare module "react" {
  // React Three Fiber extends React's JSX element catalog at compile time.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useI18n } from "../i18n/i18n.tsx";
import {
  transportMetrics,
  type LogisticsVisualization,
} from "./logistics-metrics.ts";

const colors = ["#c81d25", "#2f6fed", "#16a34a"];

export default function Logistics3DView({
  data,
}: {
  data: LogisticsVisualization;
}) {
  const { locale } = useI18n();
  const metrics = transportMetrics(data);
  const unit = data.transportUnits[0];
  const placements = unit
    ? data.placements.filter(
        (item) => item.planTransportUnitId === unit.planTransportUnitId,
      )
    : [];
  if (!unit || placements.length === 0)
    return (
      <div className="empty-state">
        <h2>
          {locale === "ar"
            ? "لا يوجد توزيع ثلاثي الأبعاد بعد"
            : "No 3D placement yet"}
        </h2>
      </div>
    );
  const length = Number(unit.lengthMmSnapshot) / 1000;
  const width = Number(unit.widthMmSnapshot) / 1000;
  return (
    <div className="transport-3d-shell">
      <p className="scope-note">
        {locale === "ar"
          ? `عرض محسوب للحمولة: ${String(metrics.loaded)} لوح، دون تداخل، بزوايا 0° أو 90° فقط.`
          : `Calculated load: ${String(metrics.loaded)} boards, non-overlapping, using 0° or 90° rotations only.`}
      </p>
      <div className="transport-canvas">
        <Canvas
          camera={{ position: [6.5, 5.5, 7], fov: 48 }}
          dpr={[1, 1.5]}
          fallback={
            <p>
              {locale === "ar"
                ? "العرض ثلاثي الأبعاد غير متاح على هذا الجهاز"
                : "3D is unavailable on this device"}
            </p>
          }
        >
          <ambientLight intensity={1.35} />
          <directionalLight position={[5, 8, 5]} intensity={2.2} />
          <gridHelper args={[12, 12, "#3857a6", "#1a2760"]} />
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[length, 0.12, width]} />
            <meshStandardMaterial color="#24346f" wireframe />
          </mesh>
          {placements.map((placement, index) => {
            const boxLength = Number(placement.lengthMm) / 1000;
            const boxWidth = Number(placement.widthMm) / 1000;
            const boxHeight = Number(placement.heightMm) / 1000;
            const x = Number(placement.xMm) / 1000 + boxLength / 2 - length / 2;
            const z = Number(placement.yMm) / 1000 + boxWidth / 2 - width / 2;
            return (
              <mesh
                key={placement.placementId}
                position={[x, boxHeight / 2 + 0.12, z]}
              >
                <boxGeometry args={[boxLength, boxHeight, boxWidth]} />
                <meshStandardMaterial
                  color={colors[index % colors.length] ?? "#c81d25"}
                  transparent
                  opacity={0.9}
                />
                <Html
                  center
                  position={[0, boxHeight / 2 + 0.16, 0]}
                  style={{
                    color: "white",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    fontSize: 12,
                  }}
                >
                  {placement.stackQty} × {placement.rotationCode}°
                </Html>
              </mesh>
            );
          })}
          <OrbitControls enablePan maxPolarAngle={Math.PI / 2.05} />
        </Canvas>
      </div>
    </div>
  );
}
