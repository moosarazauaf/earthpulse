/** Sentri, the assistant: a small chat beside the globe, and the button that opens it. */
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useStore } from "../app/store";
import { type Card, type Message, agentOnline, ask } from "./agent";
import { CAN_RUN, COMING, pickExamples } from "./args";
import type { Finding } from "./s1checks";
import { type Mood, Sentri } from "./Sentri";

interface Entry { who: "you" | "sentri"; text: string; cards?: Card[]; warn?: boolean; next?: string[] }

/** The chat is kept in this browser only, so it survives a reload until the user clears it. */
const SAVED = "earthpulse.sentri.v1";
function loadChat(): { entries: Entry[]; history: Message[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED) ?? "null") as { entries?: Entry[]; history?: Message[] } | null;
    return { entries: Array.isArray(raw?.entries) ? raw.entries : [], history: Array.isArray(raw?.history) ? raw.history : [] };
  } catch {
    return { entries: [], history: [] };
  }
}
function saveChat(entries: Entry[], history: Message[]) {
  try {
    if (entries.length) localStorage.setItem(SAVED, JSON.stringify({ entries: entries.slice(-60), history }));
    else localStorage.removeItem(SAVED);
  } catch {
    // Storage full or blocked (private window): the chat still works, it just is not kept.
  }
}


const STATUS: Record<Mood, string> = {
  idle: "Watching the Earth",
  thinking: "Scanning the archive…",
  happy: "Done",
  warn: "Found something to check",
};

const MARK: Record<Finding["level"], string> = { ok: "✓", warn: "!", error: "✕" };

function Findings({ findings }: { findings: Finding[] }) {
  return (
    <ul className="findings">
      {findings.map((f, i) => <li key={i} className={f.level}><span aria-label={f.level}>{MARK[f.level]}</span> {f.text}</li>)}
    </ul>
  );
}

/** The floating button that opens Sentri; hidden while the chat is open. */
export function SentriLauncher() {
  const open = useStore((s) => s.agentOpen);
  const set = useStore((s) => s.set);
  if (open) return null;
  return (
    <button className="sentri-launcher" onClick={() => set({ agentOpen: true, introOpen: false })} aria-label="Ask Sentri, the EarthPulse assistant">
      <Sentri size={44} />
      <span>Ask Sentri</span>
    </button>
  );
}

export function AgentPanel() {
  const open = useStore((s) => s.agentOpen);
  const set = useStore((s) => s.set);
  const [entries, setEntries] = useState<Entry[]>(() => loadChat().entries);
  const [history, setHistory] = useState<Message[]>(() => loadChat().history);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cheer, setCheer] = useState(false);
  // A new handful of example questions for every new chat.
  const [examples, setExamples] = useState(() => pickExamples());
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [entries, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => saveChat(entries, history), [entries, history]);
  // Reopening an empty chat brings new examples too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !entries.length) setExamples(pickExamples()); }, [open]);
  useEffect(() => {
    if (!cheer) return;
    const t = window.setTimeout(() => setCheer(false), 2400);
    return () => window.clearTimeout(t);
  }, [cheer]);
  if (!open) return null;

  const last = entries.at(-1);
  const mood: Mood = busy ? "thinking" : last?.who === "sentri" && last.warn ? "warn" : cheer ? "happy" : "idle";

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
      const warn = turn.cards.some((c) => c.findings.some((f) => f.level !== "ok"));
      setEntries((e) => [...e, { who: "sentri", text: turn.text, cards: turn.cards, warn, next: turn.next }]);
      setCheer(!warn);
    } catch {
      if (!controller.current.signal.aborted) setEntries((e) => [...e, { who: "sentri", text: "Something went wrong; try again.", warn: true }]);
    } finally {
      setBusy(false);
    }
  }
  function clearChat() {
    controller.current?.abort();
    setEntries([]);
    setHistory([]);
    setBusy(false);
    setExamples(pickExamples());
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <aside className="agent" aria-label="Sentri, the EarthPulse assistant">
      <header className="agent-head">
        <Sentri mood={mood} size={56} title={`Sentri: ${STATUS[mood]}`} />
        <div>
          <h2>Sentri</h2>
          <p className="agent-status" role="status"><span className={`dot ${mood}`} aria-hidden="true" />{STATUS[mood]}</p>
        </div>
        <div className="agent-actions">
          {entries.length > 0 && <button className="ghost" onClick={clearChat} title="Clear this chat and start a new one" aria-label="Clear chat">🗑</button>}
          <button className="ghost" onClick={() => set({ agentOpen: false })} aria-label="Close Sentri">×</button>
        </div>
      </header>
      <div className="agent-log" aria-live="polite">
        {!entries.length && (
          <div className="agent-hello">
            <p><strong>Hi, I&apos;m Sentri.</strong> I watch the Earth with Landsat and Sentinel. Ask me in plain words, or paste a Google Earth Engine Sentinel-1 script and I&apos;ll check it.</p>
            <details>
              <summary>What I can run so far</summary>
              <ul className="can-run">{CAN_RUN.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="muted">{COMING}</p>
            </details>
            <div className="chips">
              {examples.map((x) => <button key={x} className="chip" onClick={() => void send(undefined, x)}>{x}</button>)}
            </div>
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`msg ${e.who}`}>
            {e.who === "sentri" && <Sentri size={22} mood={e.warn ? "warn" : "idle"} />}
            <div className="bubble">
              <p>{e.text}</p>
              {e.cards?.map((c, j) => (
                <div key={j} className="agent-card">
                  <strong>{c.title}</strong>
                  {c.kind !== "checks" && <ul className="facts-list">{c.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
                  {c.findings.length > 0 && <Findings findings={c.findings} />}
                  {c.kind === "plan" && <p className="muted">The plan is open in the side panel: check it, then press Run.</p>}
                </div>
              ))}
              {e.next && i === entries.length - 1 && !busy && (
                <div className="chips">{e.next.map((x) => <button key={x} className="chip" onClick={() => void send(undefined, x)}>{x}</button>)}</div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg sentri typing" aria-hidden="true">
            <Sentri size={22} mood="thinking" />
            <div className="bubble"><span className="pixel-dots"><i /><i /><i /></span></div>
          </div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={send}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} maxLength={20_000}
          placeholder="Floods in Layyah, August 2022… or paste a script" aria-label="Message to Sentri" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send">➤</button>
      </form>
      <p className="muted small">
        {agentOnline
          ? "Sentri runs on a free NVIDIA Nemotron model through OpenRouter, which reads what you type. Numbers, dates and checks come from EarthPulse's own code. The chat is kept in this browser only; 🗑 clears it."
          : "Built-in reader on this build (no language model). The chat is kept in this browser only; 🗑 clears it."}
      </p>
    </aside>
  );
}
