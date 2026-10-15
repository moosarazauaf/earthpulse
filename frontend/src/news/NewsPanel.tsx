/** Natural hazards in the news: the story list, a story, and what led up to it. */
import { useEffect, useMemo, useState } from "react";

import { useStore } from "../app/store";
import { PIXEL_BUDGET, deviceProfile } from "../engine/client";
import { KindBadge } from "../ui/KindBadge";
import { type StoryAction, storyActions } from "./actions";
import { type Corroboration, corroborate } from "./corroborate";
import { HAZARD_INFO, ago } from "./hazards";
import type { Hazard, NewsStory } from "./types";
import { BASELINE, type WeatherContext, describe, fetchWeatherContext, windowDates } from "./weather";

const PRECISION = { city: "town", region: "province or state", country: "country only" } as const;
const WET: Hazard[] = ["flood", "rain", "landslide", "storm", "tornado", "tsunami"];

function outlets(story: NewsStory): number {
  return new Set(story.articles.map((a) => a.source)).size;
}

function Dot({ hazard }: { hazard: Hazard }) {
  return <span className="dot" style={{ background: HAZARD_INFO[hazard].colour }} aria-hidden="true" />;
}

function Badges({ c }: { c: Corroboration }) {
  return (
    <>
      {c.quake && <span className="tag ok">USGS M{c.quake.magnitude.toFixed(1)}</span>}
      {c.alert && <span className="tag ok">GDACS {c.alert.level.toLowerCase()}</span>}
    </>
  );
}

export function NewsTab() {
  const news = useStore((s) => s.news);
  const error = useStore((s) => s.newsError);
  const selected = useStore((s) => s.selectedStory);
  const quakes = useStore((s) => s.quakes);
  const alerts = useStore((s) => s.alerts);
  const loadNews = useStore((s) => s.loadNews);
  const set = useStore((s) => s.set);
  const [hours, setHours] = useState<24 | 72>(24);
  const [hazard, setHazard] = useState<Hazard | "all">("all");

  useEffect(() => {
    if (news === null && !error) void loadNews();
  }, [news, error, loadNews]);

  const recent = useMemo(() => {
    const cutoff = Date.now() - hours * 3_600_000;
    return (news?.stories ?? []).filter((s) => new Date(s.last).getTime() >= cutoff);
  }, [news, hours]);
  const present = useMemo(() => [...new Set(recent.map((s) => s.hazard))], [recent]);
  const shown = recent.filter((s) => hazard === "all" || s.hazard === hazard);

  if (selected) return <StoryDetail story={selected} />;

  return (
    <section>
      {error && (
        <p className="note" role="alert">{error} <button className="link" onClick={() => void loadNews()}>Try again</button></p>
      )}
      {news === null && !error && <p className="muted" role="status">Loading the news scan…</p>}
      {news && (
        <>
          <div className="seg" role="radiogroup" aria-label="Time window">
            {([24, 72] as const).map((h) => (
              <button key={h} role="radio" aria-checked={hours === h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>
                {h === 24 ? "Last 24 hours" : "Last 3 days"}
              </button>
            ))}
          </div>
          {present.length > 1 && (
            <div className="chips" role="radiogroup" aria-label="Hazard">
              <button role="radio" aria-checked={hazard === "all"} className={hazard === "all" ? "on" : ""} onClick={() => setHazard("all")}>All · {recent.length}</button>
              {present.map((h) => (
                <button key={h} role="radio" aria-checked={hazard === h} className={hazard === h ? "on" : ""} onClick={() => setHazard(h)}>
                  <Dot hazard={h} /> {HAZARD_INFO[h].label}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="muted">No hazard stories found in this window.</p>
          ) : (
            <ul className="stories">
              {shown.map((story) => (
                <li key={story.id}>
                  <button className="story-row" onClick={() => set({ selectedStory: story })}>
                    <span className="story-kind"><Dot hazard={story.hazard} /> {HAZARD_INFO[story.hazard].label} · {story.place.name}{story.place.country ? `, ${story.place.country}` : ""}</span>
                    <strong>{story.articles[0]?.title}</strong>
                    <em>
                      {outlets(story)} {outlets(story) === 1 ? "outlet" : "outlets"} · {ago(story.last)}{" "}
                      <Badges c={corroborate(story, quakes, alerts)} />
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Scanned every hour from the public feeds of {news.feeds.length} news outlets and agencies
            {news.generated ? `; last scan ${news.generated.slice(11, 16)} UTC` : ""}. Headlines are matched by keyword and
            placed from the place names they contain, automatically, so some will be misplaced or off-topic.
            Read the source before relying on any of it.
          </p>
          <details className="muted">
            <summary>Outlets scanned</summary>
            <ul className="feeds">
              {news.feeds.map((f) => (
                <li key={f.name}>
                  <a href={f.homepage} target="_blank" rel="noopener noreferrer">{f.name}</a>
                  {f.ok ? "" : " (unreachable at the last scan)"}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function StoryDetail({ story }: { story: NewsStory }) {
  const set = useStore((s) => s.set);
  const quakes = useStore((s) => s.quakes);
  const alerts = useStore((s) => s.alerts);
  const c = corroborate(story, quakes, alerts);
  const info = HAZARD_INFO[story.hazard];

  return (
    <>
      <section>
        <button className="link back" onClick={() => set({ selectedStory: null })}>← All stories</button>
        <p className="eyebrow"><Dot hazard={story.hazard} /> {story.hazards.map((h) => HAZARD_INFO[h].label).join(", ")}</p>
        <h2 className="story-title">{info.label} · {story.place.name}{story.place.country ? `, ${story.place.country}` : ""}</h2>
        <p className="muted">
          Placed from the place names in the headlines ({PRECISION[story.place.precision]}). First reported {ago(story.first)},
          by {outlets(story)} {outlets(story) === 1 ? "outlet" : "outlets"}.
        </p>
        <Evidence c={c} story={story} />
      </section>
      <section>
        <h3>What the outlets report</h3>
        <ul className="headlines">
          {story.articles.map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
              <span className="muted">{a.source} · {ago(a.published)}</span>
            </li>
          ))}
        </ul>
      </section>
      <WhyItHappened story={story} c={c} />
      <LookFromSpace story={story} />
      <section>
        <p className="muted">
          Wrong place, or not a natural hazard?{" "}
          <a href={reportUrl(story)} target="_blank" rel="noopener noreferrer">Report it on GitHub</a>. Each report
          becomes a test case for the keyword and place rules, so the same mistake is not made twice.
        </p>
      </section>
    </>
  );
}

/** A pre-filled GitHub issue describing a story the scanner got wrong. Only public story data goes in it. */
export function reportUrl(story: NewsStory): string {
  const lines = [
    "**What is wrong?** (wrong place / not a natural hazard / wrong hazard / other)",
    "",
    "",
    "---",
    `Story: \`${story.id}\``,
    `Filed as: ${story.hazard} (${story.hazards.join(", ")})`,
    `Placed at: ${story.place.name}${story.place.country ? `, ${story.place.country}` : ""} (${story.place.precision})`,
    "Headlines:",
    ...story.articles.slice(0, 5).map((a) => `- ${a.title} (${a.source}) ${a.url}`),
  ];
  const query = new URLSearchParams({
    title: `News scan: ${story.articles[0]?.title.slice(0, 80) ?? story.id}`,
    labels: "news-scan",
    body: lines.join("\n"),
  });
  return `https://github.com/moosarazauaf/earthpulse/issues/new?${query.toString()}`;
}

function Evidence({ c, story }: { c: Corroboration; story: NewsStory }) {
  if (c.quake) {
    return (
      <p className="evidence ok">
        Matches a USGS-recorded earthquake: <strong>M{c.quake.magnitude.toFixed(1)}</strong>, {Math.round(c.quake.depthKm)} km deep,{" "}
        {c.quake.place}, {c.quake.time.slice(0, 16).replace("T", " ")} UTC. The marker is at the USGS epicentre.{" "}
        <a href={c.quake.url} target="_blank" rel="noopener noreferrer">USGS event page</a>
      </p>
    );
  }
  if (c.alert) {
    return (
      <p className="evidence ok">
        Matches a GDACS {c.alert.level.toLowerCase()} alert: {c.alert.name}.{" "}
        <a href={c.alert.reportUrl} target="_blank" rel="noopener noreferrer">GDACS report</a>
      </p>
    );
  }
  const what = story.hazards.includes("earthquake") ? "the USGS catalogue (M4.5 and above)" : "GDACS alerts";
  return <p className="evidence">No match in {what} yet. These are news reports only; small or local events often have no agency record.</p>;
}

// ---- how did it happen -------------------------------------------------------------------

function WhyItHappened({ story, c }: { story: NewsStory; c: Corroboration }) {
  const wet = story.hazards.some((h) => WET.includes(h));
  const weather = wet || ["wildfire", "heat", "drought"].includes(story.hazard);
  return (
    <section>
      <h3>How did it happen?</h3>
      {story.hazard === "earthquake" || story.hazard === "tsunami" ? <QuakeContext c={c} /> : null}
      {weather && story.place.precision !== "country" ? <WeatherBefore story={story} /> : null}
      {weather && story.place.precision === "country" && (
        <p className="muted">This story is placed only to the country, so there is no single point to read the weather for.</p>
      )}
      {story.hazard === "volcano" && (
        <p className="muted">
          Eruptions are driven by magma beneath the volcano, which satellites in EarthPulse cannot see. The Smithsonian{" "}
          <a href="https://volcano.si.edu/reports_weekly.cfm" target="_blank" rel="noopener noreferrer">Global Volcanism Program</a>{" "}
          publishes weekly activity reports.
        </p>
      )}
      {story.hazard === "winter" || story.hazard === "dust" ? <p className="muted">No automatic context for this kind of hazard yet.</p> : null}
    </section>
  );
}

function QuakeContext({ c }: { c: Corroboration }) {
  if (!c.quake) return <p className="muted">Without a matching USGS record there is no magnitude or depth to explain.</p>;
  const q = c.quake;
  const shallow = q.depthKm < 70;
  return (
    <div className="why">
      <p>
        The rupture was {Math.round(q.depthKm)} km below the surface. {shallow
          ? "Earthquakes shallower than about 70 km shake the ground above them hardest, which is why shallow ones do the most damage."
          : "Deeper earthquakes spread their energy over a wider area, so shaking at the surface is usually weaker than the magnitude suggests."}
      </p>
      <p>
        Each step of one in magnitude releases about 32 times more energy: an M{q.magnitude.toFixed(1)} releases roughly{" "}
        {Math.round(32 ** (q.magnitude - 4)).toLocaleString("en")} times the energy of an M4.0, a quake that is felt but rarely damages buildings.
      </p>
      {q.pager && <p>USGS PAGER estimate of losses: <strong>{q.pager}</strong>. This is an automatic estimate, revised as reports arrive.</p>}
      {q.tsunami && <p>The USGS has flagged this event for possible tsunami. Follow the official tsunami warning centres.</p>}
      <p className="muted">Earthquakes on land can set off landslides in steep terrain; that can be checked from space below.</p>
    </div>
  );
}

function WeatherBefore({ story }: { story: NewsStory }) {
  const [context, setContext] = useState<WeatherContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventDay = story.first.slice(0, 10);

  useEffect(() => {
    const controller = new AbortController();
    setContext(null);
    setError(null);
    fetchWeatherContext(story.place.lat, story.place.lon, eventDay, controller.signal)
      .then(setContext)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Weather could not be loaded."); });
    return () => controller.abort();
  }, [story.place.lat, story.place.lon, eventDay]);

  if (error) return <p className="note">{error}</p>;
  if (!context) return <p className="muted" role="status">Reading the weather before the event…</p>;
  const wet = story.hazards.some((h) => WET.includes(h));
  const windows = story.hazard === "drought" ? context.rain.filter((r) => r.days === 90) : context.rain.filter((r) => r.days !== 90 && (wet || r.days === 30));
  return (
    <div className="why">
      <header className="row"><strong>Weather at {story.place.name} before {eventDay}</strong><KindBadge kind="MODELED" /></header>
      {story.place.precision === "region" && (
        <p className="muted">Read at the population centre of {story.place.name}, which may be far from where the event happened. Large regions can have very different weather in different parts.</p>
      )}
      <RainChart context={context} />
      <ul className="facts-list">
        {windows.map((w) => <li key={w.days}>{describe(w, "rain")}</li>)}
        {(story.hazard === "heat" || story.hazard === "wildfire") && context.heat && <li>{describe(context.heat, "tmax")}</li>}
      </ul>
      <p className="muted">
        Model estimates for one grid cell from Open-Meteo: recent days from its weather models, the {BASELINE.first} to{" "}
        {BASELINE.last} baseline from ERA5 reanalysis. They are not rain-gauge measurements, local downpours can be missed,
        and the two models differ, so treat the comparison as indicative. Rain is one cause among several; slopes,
        rivers, drainage and land use decide what floods.
      </p>
    </div>
  );
}

function RainChart({ context }: { context: WeatherContext }) {
  const dates = windowDates(context.eventDay, 30);
  const index = new Map(context.recent.time.map((t, i) => [t, i]));
  const values = dates.map((d) => { const i = index.get(d); return i === undefined ? null : context.recent.rain[i] ?? null; });
  const max = Math.max(10, ...values.map((v) => v ?? 0));
  const W = 280, H = 70, bar = W / dates.length;
  return (
    <svg className="rain-chart" viewBox={`0 0 ${W} ${H + 14}`} role="img"
      aria-label={`Daily rain for the 30 days to ${context.eventDay}; the wettest day had ${Math.round(max)} mm`}>
      {values.map((v, i) => v === null ? null : (
        <rect key={dates[i]} x={i * bar + 0.5} y={H - (v / max) * H} width={Math.max(bar - 1, 1)} height={(v / max) * H} />
      ))}
      <line x1="0" x2={W} y1={H} y2={H} />
      <text x="0" y={H + 12}>{dates[0]?.slice(5)}</text>
      <text x={W} y={H + 12} textAnchor="end">{context.eventDay.slice(5)}</text>
      <text x="2" y="9">{Math.round(max)} mm</text>
    </svg>
  );
}

// ---- see it from space ----------------------------------------------------------------------

function LookFromSpace({ story }: { story: NewsStory }) {
  const set = useStore((s) => s.set);
  const setAoi = useStore((s) => s.setAoi);
  const device = useMemo(deviceProfile, []);
  const actions = storyActions(story, PIXEL_BUDGET[device.recommended]);
  const showFires = () => {
    const layers = useStore.getState().hazardLayers;
    set({ hazardLayers: layers.includes("fires") ? layers : [...layers, "fires"] });
  };

  function start(action: StoryAction) {
    if (!action.run) {
      // Placed only to a country: ask for the area instead of guessing one.
      set({ mode: action.mode, selectedStory: null });
      setAoi(null);
      return;
    }
    setAoi({ geometry: action.run.request.aoi, label: String(action.run.request.label) });
    set({ pendingRun: { ...action.run, fromNews: story.articles[0]?.title ?? "" }, mode: action.mode });
  }

  if (actions.length === 0 && story.hazard !== "wildfire") return null;
  return (
    <section>
      <h3>See it from space</h3>
      {story.hazard === "wildfire" && (
        <button onClick={showFires}>Show yesterday&apos;s fire detections (NASA VIIRS)</button>
      )}
      {actions.map((action) => (
        <div key={action.id} className="space-action">
          <button className="primary" onClick={() => start(action)}>{action.label}</button>
          <p className="muted">{action.explain} {action.run ? "You confirm before anything downloads; it runs on this device." : "This story is placed only to the country, so you will be asked to draw the area."}</p>
          {action.caution && <p className="muted">{action.caution}</p>}
        </div>
      ))}
    </section>
  );
}
