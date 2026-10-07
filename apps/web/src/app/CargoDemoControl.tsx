import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playing the load back, and saving it as a file.
 *
 * Two things a customer asks for that a still picture cannot answer: *in what
 * order does this go in*, and *can you send it to me*. The first is playback —
 * pieces appearing in the order a crew puts them in, at a speed you can change,
 * with a slider you can drag. The second is a recording of exactly that,
 * captured from the canvas itself rather than re-rendered, so the file is the
 * demo and not a second version of it.
 *
 * The recorder is optional in the browser sense: `captureStream` and
 * `MediaRecorder` are not everywhere, so the button is offered only when they
 * are, and the playback works regardless. An offered button that fails is worse
 * than one that was never there.
 */

/** Pieces per second, so a long load and a short one both stay watchable. */
const SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_PIECES_PER_SECOND = 3;

export interface DemoRecording {
  readonly url: string;
  readonly sizeBytes: number;
  readonly fileName: string;
}

function canRecord(): boolean {
  try {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function"
    );
  } catch {
    return false;
  }
}

/** The best container this browser will actually write. */
function recordingType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ])
    if (MediaRecorder.isTypeSupported(type)) return type;
  return null;
}

export function CargoDemoControl({
  pieces,
  revealed,
  onRevealed,
  canvasOf,
  labels,
  reference,
}: {
  /** How many pieces the finished load has. */
  pieces: number;
  revealed: number;
  onRevealed: (value: number) => void;
  /** The canvas to record, looked up when recording starts. */
  canvasOf: () => HTMLCanvasElement | null;
  labels: {
    title: string;
    hint: string;
    play: string;
    pause: string;
    restart: string;
    speed: string;
    record: string;
    recording: string;
    download: string;
    unavailable: string;
    progress: string;
  };
  /** Names the saved file after the shipment rather than after the browser. */
  reference: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState<DemoRecording | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const supported = useRef(canRecord());

  // Advance by wall-clock time, not by frame: a browser that drops frames
  // would otherwise play the same load back more slowly on a slower machine.
  const started = useRef<{ at: number; from: number } | null>(null);
  useEffect(() => {
    if (!playing) {
      started.current = null;
      return;
    }
    started.current = { at: performance.now(), from: revealed };
    let frame = 0;
    const step = () => {
      const from = started.current;
      if (from === null) return;
      const seconds = (performance.now() - from.at) / 1000;
      const next = Math.min(
        pieces,
        from.from + Math.floor(seconds * BASE_PIECES_PER_SECOND * speed),
      );
      onRevealed(next);
      if (next >= pieces) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
    // `revealed` is deliberately absent: it is read once, when playback
    // starts, and owned by the loop from then on. Listing it would tear the
    // loop down and rebuild it on every single piece.
  }, [playing, speed, pieces, onRevealed]);

  const stopRecording = useCallback(() => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }, []);

  // A recording follows the playback: it ends when the load does.
  useEffect(() => {
    if (recording && revealed >= pieces) stopRecording();
  }, [recording, revealed, pieces, stopRecording]);

  const startRecording = () => {
    const canvas = canvasOf();
    const type = recordingType();
    if (canvas === null || type === null) return;
    const chunks: Blob[] = [];
    const media = new MediaRecorder(canvas.captureStream(30), {
      mimeType: type,
    });
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      const blob = new Blob(chunks, { type });
      // The old one is revoked: a session that records five times should not
      // be holding five videos in memory.
      setSaved((current) => {
        if (current !== null) URL.revokeObjectURL(current.url);
        return {
          url: URL.createObjectURL(blob),
          sizeBytes: blob.size,
          fileName: `ACROW-loading-${reference.replace(/[^\w-]+/g, "-")}.webm`,
        };
      });
    };
    recorder.current = media;
    media.start();
    setRecording(true);
    onRevealed(0);
    setPlaying(true);
  };

  useEffect(
    () => () => {
      recorder.current?.stop();
    },
    [],
  );

  const atEnd = revealed >= pieces;
  return (
    <div className="cargo-demo">
      <div className="cargo-demo-head">
        <strong>{labels.title}</strong>
        <span className="settings-hint">{labels.hint}</span>
      </div>

      <div className="cargo-demo-row">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (atEnd && !playing) onRevealed(0);
            setPlaying(!playing);
          }}
        >
          {playing ? labels.pause : atEnd ? labels.restart : labels.play}
        </button>

        <input
          type="range"
          min={0}
          max={pieces}
          value={revealed}
          aria-label={labels.progress}
          onChange={(event) => {
            setPlaying(false);
            onRevealed(Number(event.target.value));
          }}
        />
        <span className="cargo-demo-count">
          {revealed} / {pieces}
        </span>

        <label className="cargo-demo-speed">
          {labels.speed}
          <select
            value={speed}
            onChange={(event) => {
              setSpeed(Number(event.target.value));
            }}
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="cargo-demo-row">
        {supported.current ? (
          <button
            type="button"
            className="secondary"
            disabled={recording}
            onClick={startRecording}
          >
            {recording ? labels.recording : labels.record}
          </button>
        ) : (
          <span className="settings-hint">{labels.unavailable}</span>
        )}
        {saved !== null && (
          <a
            className="cargo-demo-save"
            href={saved.url}
            download={saved.fileName}
          >
            {labels.download} ({Math.round(saved.sizeBytes / 1024)} KB)
          </a>
        )}
      </div>
    </div>
  );
}
