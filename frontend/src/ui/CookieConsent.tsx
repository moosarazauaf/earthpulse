/** Cookie consent banner (GDPR/ePrivacy compliant). */
import { useEffect, useState } from "react";
import { useStore } from "../app/store";
import { useT } from "../i18n";
import { openLegal } from "./Legal";

const CONSENT_KEY = "earthpulse_consent";

type Consent = {
  necessary: true;
  analytics: boolean;
  preferences: boolean;
  timestamp: string;
  version: number;
};

export function CookieConsent() {
  const t = useT();
  const set = useStore((s) => s.set);
  const [visible, setVisible] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Consent;
        // Check version for future updates
        if (parsed.version === 1) {
          setConsent(parsed);
          return;
        }
      }
    } catch {
      // Ignore parse errors
    }
    // Show banner if no valid consent
    setVisible(true);
  }, []);

  function acceptAll() {
    const newConsent: Consent = {
      necessary: true,
      analytics: true,
      preferences: true,
      timestamp: new Date().toISOString(),
      version: 1,
    };
    saveConsent(newConsent);
  }

  function acceptNecessary() {
    const newConsent: Consent = {
      necessary: true,
      analytics: false,
      preferences: false,
      timestamp: new Date().toISOString(),
      version: 1,
    };
    saveConsent(newConsent);
  }

  function customize() {
    set({ cookieCustomizeOpen: true });
    setVisible(false);
  }

  function saveConsent(newConsent: Consent) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(newConsent));
      setConsent(newConsent);
      setVisible(false);
      // Apply consent choices
      applyConsent(newConsent);
    } catch {
      // Storage full or unavailable
    }
  }

  function applyConsent(c: Consent) {
    // Enable/disable analytics, etc.
    // EarthPulse runs locally, so analytics would only be if we added them
    if (c.analytics) {
      // Could initialize analytics here
    }
  }

  if (!visible || consent) return null;

  return (
    <div className="cookie-banner" role="dialog" aria-labelledby="cookie-title" aria-describedby="cookie-desc">
      <div className="cookie-content">
        <h3 id="cookie-title">{t("cookie.title")}</h3>
        <p id="cookie-desc">{t("cookie.description")}</p>
        <div className="cookie-actions">
          <button className="primary" onClick={acceptAll}>{t("cookie.acceptAll")}</button>
          <button className="ghost" onClick={acceptNecessary}>{t("cookie.acceptNecessary")}</button>
          <button className="ghost" onClick={customize}>{t("cookie.customize")}</button>
        </div>
        <p className="cookie-links">
          <a href="#" onClick={(e) => { e.preventDefault(); openLegal?.("privacy"); }}>{t("cookie.privacyPolicy")}</a>
          {" · "}
          <a href="#" onClick={(e) => { e.preventDefault(); openLegal?.("cookies"); }}>{t("cookie.cookiePolicy")}</a>
        </p>
      </div>
    </div>
  );
}

export function CookieCustomizeDialog() {
  const t = useT();
  const customizeOpen = useStore((s) => s.cookieCustomizeOpen);
  const set = useStore((s) => s.set);
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(false);

  if (!customizeOpen) return null;

  return (
    <div className="cookie-customize-overlay" onClick={() => set({ cookieCustomizeOpen: false })} aria-hidden="true">
      <div className="cookie-customize" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="customize-title">
        <div className="row">
          <h2 id="customize-title">{t("cookie.customizeTitle")}</h2>
          <button className="ghost" onClick={() => set({ cookieCustomizeOpen: false })} aria-label={t("legal.close")}>×</button>
        </div>
        <p>{t("cookie.customizeDescription")}</p>

        <fieldset>
          <legend>{t("cookie.categories.necessary")}</legend>
          <label className="check">
            <input type="checkbox" checked disabled />
            <span>{t("cookie.categories.necessaryDesc")}</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t("cookie.categories.preferences")}</legend>
          <label className="check">
            <input type="checkbox" checked={preferences} onChange={(e) => setPreferences(e.target.checked)} />
            <span>{t("cookie.categories.preferencesDesc")}</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t("cookie.categories.analytics")}</legend>
          <label className="check">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <span>{t("cookie.categories.analyticsDesc")}</span>
          </label>
        </fieldset>

        <div className="actions">
          <button className="ghost" onClick={() => set({ cookieCustomizeOpen: false })}>{t("cookie.cancel")}</button>
          <button className="primary" onClick={() => {
            const newConsent: Consent = {
              necessary: true,
              analytics,
              preferences,
              timestamp: new Date().toISOString(),
              version: 1,
            };
            try {
              localStorage.setItem(CONSENT_KEY, JSON.stringify(newConsent));
              set({ cookieCustomizeOpen: false });
            } catch {}
          }}>{t("cookie.save")}</button>
        </div>

        <p className="cookie-links">
          <a href="#" onClick={(e) => { e.preventDefault(); openLegal?.("privacy"); }}>{t("cookie.privacyPolicy")}</a>
          {" · "}
          <a href="#" onClick={(e) => { e.preventDefault(); openLegal?.("cookies"); }}>{t("cookie.cookiePolicy")}</a>
        </p>
      </div>
    </div>
  );
}