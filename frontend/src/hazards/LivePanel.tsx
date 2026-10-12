/** Live hazards: what agencies are reporting and forecasting right now. */
import { useEffect, useState } from "react";

import { useStore } from "../app/store";
import { KindBadge } from "../ui/KindBadge";
import { ALERT_TYPES, ALERT_WINDOW_DAYS, type Alert, type AlertType, HAZARD_LAYERS, yesterdayUtc } from "./sources";

const SYMBOL: Record<AlertType, string> = { FL: "≈", WF: "▲", TC: "◎", EQ: "◆", DR: "☼", VO: "▴" };

function AlertRow({ alert, selected }: { alert: Alert; selected: boolean }) {
  const set = useStore((s) => s.set);
  return (
    <li>
      <button className={selected ? "alert on" : "alert"} onClick={() => set({ selectedAlert: alert })}>
        <span className={`level level-${alert.level.toLowerCase()}`}>
          <span aria-hidden="true">{SYMBOL[alert.type]}</span> {alert.level}
        </span>
        <strong>{alert.name}</strong>
        <em>
          {ALERT_TYPES[alert.type]}{alert.country ? ` · ${alert.country}` : ""} ·{" "}
          {alert.ongoing ? `ongoing since ${alert.from}` : `${alert.from} to ${alert.to}`}
        </em>
      </button>
    </li>
  );
}

export function LivePanel() {
  const alerts = useStore((s) => s.alerts);
  const error = useStore((s) => s.alertsError);
  const selected = useStore((s) => s.selectedAlert);
  const active = useStore((s) => s.hazardLayers);
  const loadAlerts = useStore((s) => s.loadAlerts);
  const set = useStore((s) => s.set);
  const quakes = useStore((s) => s.quakes);
  const quakesOn = useStore((s) => s.quakesOn);
  const loadQuakes = useStore((s) => s.loadQuakes);
  const feedsAt = useStore((s) => s.feedsAt);
  const [filter, setFilter] = useState<AlertType | "all">("all");

  useEffect(() => {
    if (alerts === null && !error) void loadAlerts();
  }, [alerts, error, loadAlerts]);

  const shown = (alerts ?? []).filter((a) => filter === "all" || a.type === filter);
  const present = [...new Set((alerts ?? []).map((a) => a.type))];
  const toggle = (id: string) =>
    set({ hazardLayers: active.includes(id) ? active.filter((x) => x !== id) : [...active, id] });

  return (
    <div className="results">
      <section>
        <h3>On the map</h3>
        <ul className="hazard-layers">
          {HAZARD_LAYERS.map((layer) => (
            <li key={layer.id}>
              <label className="check">
                <input type="checkbox" checked={active.includes(layer.id)} onChange={() => toggle(layer.id)} />
                <span><strong>{layer.answers}</strong></span>
                <KindBadge kind={layer.kind} />
              </label>
              {active.includes(layer.id) && (
                <p className="muted">
                  {layer.title}{layer.time === "yesterday" ? `, ${yesterdayUtc()} (UTC)` : ", latest issue"}. {layer.provider}.{" "}
                  {layer.caveat}
                </p>
              )}
            </li>
          ))}
        </ul>
        <ul className="hazard-layers">
          <li>
            <label className="check">
              <input type="checkbox" checked={quakesOn}
                onChange={(e) => { set({ quakesOn: e.target.checked }); if (e.target.checked && quakes === null) void loadQuakes(); }} />
              <span><strong>Where has the ground shaken?</strong></span>
              <KindBadge kind="OBSERVED" />
            </label>
            {quakesOn && (
              <p className="muted">
                Earthquakes of magnitude 4.5 and above in the past 7 days, from the USGS.
                {quakes && quakes[0] ? ` ${quakes.length} recorded; the strongest was M${quakes[0].magnitude.toFixed(1)}, ${quakes[0].place}.` : quakes ? " None recorded." : " Loading…"}
                {" "}Magnitudes are revised as more stations report.
              </p>
            )}
          </li>
        </ul>
        <p className="muted">No open landslide forecast could be connected yet, so landslides are not shown.</p>
      </section>

      <section>
        <header className="row">
          <h3>Red and orange alerts</h3>
          <KindBadge kind="ESTIMATED" />
        </header>
        {error && (
          <p className="note" role="alert">
            {error} <button className="link" onClick={() => void loadAlerts()}>Try again</button>
          </p>
        )}
        {alerts === null && !error && <p className="muted" role="status">Loading alerts…</p>}
        {alerts && (
          <>
            <div className="seg" role="radiogroup" aria-label="Alert type">
              <button role="radio" aria-checked={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
                All · {alerts.length}
              </button>
              {present.map((type) => (
                <button key={type} role="radio" aria-checked={filter === type} className={filter === type ? "on" : ""} onClick={() => setFilter(type)}>
                  {ALERT_TYPES[type]}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="muted">No red or orange alerts of this kind in the last {ALERT_WINDOW_DAYS} days.</p>
            ) : (
              <ul className="alerts">
                {shown.map((alert) => <AlertRow key={alert.id} alert={alert} selected={selected?.id === alert.id} />)}
              </ul>
            )}
          </>
        )}
        {selected && (
          <div className="alert-detail">
            <strong>{selected.name}</strong>
            {selected.severity && <p>{selected.severity}</p>}
            <p className="muted">Reported by {selected.source || "GDACS"}.</p>
            <a className="button" href={selected.reportUrl} target="_blank" rel="noreferrer">Full report on GDACS</a>
          </div>
        )}
        <p className="muted">
          {feedsAt ? `Read at ${feedsAt.slice(11, 16)} UTC. ` : ""}
          <button className="link" onClick={() => void loadAlerts()}>Refresh</button>{" "}
          Alerts from the Global Disaster Alert and Coordination System (UN and European Commission), last{" "}
          {ALERT_WINDOW_DAYS} days. Red and orange are GDACS's own estimates of likely humanitarian impact,
          made automatically. They are not official warnings: for decisions about safety, follow your
          national authorities.
        </p>
      </section>
    </div>
  );
}
