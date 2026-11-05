/** The assistant: a small chat beside the globe. */
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useStore } from "../app/store";
import { type Card, type Message, agentOnline, ask } from "./agent";
import type { Finding } from "./s1checks";

interface Entry { who: "you" | "assistant"; text: string; cards?: Card[] }

const EXAMPLES = [
  "Map the floods in Layyah, Pakistan, from 25 August to 5 September 2022",
  "What is the weather outlook for Multan?",
  "Show wind and sea temperature",
];

const MARK: Record<Finding["level"], string> = { ok: "✓", warn: "!", error: "✕" };

function Findings({ findings }: { findings: Finding[] }) {
  return (
    <ul className="findings">
      {findings.map((f, i) => <li key={i} className={f.level}><span aria-label={f.level}>{MARK[f.level]}</span> {f.text}</li>)}
    </ul>
  );
}

export function AgentPanel() {
  const open = useStore((s) => s.agentOpen);
  const set = useStore((s) => s.set);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [entries, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  if (!open) return null;

  async function send(event?: FormEvent, preset?: string) {
    event?.preventDefault();
    const q = (preset ?? text).trim();
    if (!q || busy) return;
    setText("");
    setEntries((e) => [...e, { who: "you", text: q }]);
    setBusy(true);
    controller.current = new AbortController();
    try {
      const turn = await ask(q, history, controller.current.signal);
      setHistory(turn.history);
      setEntries((e) => [...e, { who: "assistant", text: turn.text, cards: turn.cards }]);
    } catch {
      if (!controller.current.signal.aborted) setEntries((e) => [...e, { who: "assistant", text: "Something went wrong; try again." }]);
    } finally {
      setBusy(false);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <aside className="agent" aria-label="Assistant">
      <header className="row">
        <h2>Assistant</h2>
        <button className="ghost" onClick={() => { controller.current?.abort(); set({ agentOpen: false }); }} aria-label="Close the assistant">×</button>
      </header>
      <div className="agent-log" aria-live="polite">
        {!entries.length && (
          <div className="muted">
            <p>Ask for an analysis in plain words, or paste a Google Earth Engine Sentinel-1 script to check it for mixed orbits and compositing.</p>
            {EXAMPLES.map((x) => <button key={x} className="link example" onClick={() => void send(undefined, x)}>{x}</button>)}
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`msg ${e.who}`}>
            <p>{e.text}</p>
            {e.cards?.map((c, j) => (
              <div key={j} className="agent-card">
                <strong>{c.title}</strong>
                {c.kind === "plan" && <ul className="facts-list">{c.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
                {c.findings.length > 0 && <Findings findings={c.findings} />}
                {c.kind === "plan" && <p className="muted">The plan is open in the side panel: check it, then press Run.</p>}
              </div>
            ))}
          </div>
        ))}
        {busy && <p className="muted" role="status">Working…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} maxLength={20_000}
          placeholder="Floods in Layyah, August 2022… or paste a script" aria-label="Message to the assistant" />
        <button type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
      <p className="muted small">
        {agentOnline
          ? "A free NVIDIA Nemotron model through OpenRouter reads your message; what you type is sent there. Numbers, dates and checks come from EarthPulse's own code. The model can misread you: check the plan before running it."
          : "Built-in reader (no language model on this build). Pasted scripts are checked here in your browser."}
      </p>
    </aside>
  );
}
