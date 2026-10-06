/** Right panel. Its content follows the mode and the state of the analysis. */
import { useState } from "react";

import { useStore } from "../app/store";
import { AnalysisForm } from "./AnalysisForm";
import { Evidence } from "./Evidence";
import { FloodForm, FloodResults } from "./FloodPanel";
import { ChangeResults, SeriesResults } from "./Results";

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  ACQUIRING_DATA: "Acquiring data",
  PROCESSING_IMAGERY: "Processing imagery",
  CALCULATING_INDICES: "Calculating indices",
  DETECTING_CHANGE: "Detecting change",
  // FloodLens reports the same stages; for radar "indices" is the water threshold.
  GENERATING_RESULTS: "Generating results",
};

/** Lists the server's stages and marks the one it reports being in. No timers. */
function Progress() {
  const job = useStore((s) => s.job);
  const cancel = useStore((s) => s.cancelJob);
  const stages = (job.record?.stages ?? Object.keys(STAGE_LABELS)).filter((x) => x !== "COMPLETE");
  const current = job.record ? stages.indexOf(job.record.stage) : -1;
  return (
    <section className="progress" role="status" aria-live="polite">
      <h3>Running analysis{job.record ? ` ${job.record.id}` : ""}</h3>
      <ol>
        {stages.map((stage, i) => (
          <li key={stage} className={i < current ? "done" : i === current ? "now" : ""}>
            <i aria-hidden="true" />{STAGE_LABELS[stage] ?? stage}
            {i === current && <span className="sr-only"> (in progress)</span>}
          </li>
        ))}
      </ol>
      <p className="muted">
        Scenes are read from the archive on demand. A district-sized area takes two to four minutes.
      </p>
      <button className="link" onClick={cancel}>Stop waiting</button>
    </section>
  );
}

export function ContextPanel() {
  const mode = useStore((s) => s.mode);
  const job = useStore((s) => s.job);
  const result = useStore((s) => s.result);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(true);
  if (mode === "explore" && !result && job.status === "idle") return null;

  const running = job.status === "submitting" || job.status === "running";
  const title = mode === "research" ? "Evidence" : mode === "floods" ? "FloodLens" : "What changed here?";

  return (
    <aside className={`panel right${open ? "" : " collapsed"}`} aria-label={title}>
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="panel-body">
          {mode === "research" ? (
            result ? <Evidence result={result} /> : (
              <section>
                <p>No analysis yet. Every result EarthPulse produces lists its scenes, method and limits here.</p>
                <button onClick={() => set({ mode: "change" })}>Run an analysis</button>
              </section>
            )
          ) : (
            <>
              {running && <Progress />}
              {job.status === "failed" && job.error && (
                <section className="error" role="alert">
                  <strong>{job.error.message}</strong>
                  {job.error.hint && <p>{job.error.hint}</p>}
                </section>
              )}
              {!running && result?.type === "change" && <ChangeResults result={result} />}
              {!running && result?.type === "timeseries" && <SeriesResults result={result} />}
              {!running && result?.type === "flood" && <FloodResults result={result} />}
              {!running && (
                <details className="form-wrap" open={!result}>
                  <summary>{result ? "New analysis" : "Set up an analysis"}</summary>
                  {mode === "floods" ? <FloodForm /> : <AnalysisForm />}
                </details>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
