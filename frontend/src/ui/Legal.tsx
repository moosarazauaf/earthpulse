/** Legal pages: Privacy Policy, Cookie Policy, Terms of Service. */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../app/store";
import { useT } from "../i18n";

type LegalPage = "privacy" | "cookies" | "terms";

function LegalContent({ page }: { page: LegalPage }) {
  const t = useT();

  if (page === "privacy") {
    return (
      <div className="legal-content">
        <h2>{t("legal.privacy.title")}</h2>
        <p className="legal-updated">{t("legal.privacy.updated", { date: "2026-10-24" })}</p>

        <section>
          <h3>{t("legal.privacy.sections.controller.title")}</h3>
          <p>{t("legal.privacy.sections.controller.text")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.data.title")}</h3>
          <p>{t("legal.privacy.sections.data.text1")}</p>
          <ul>
            <li>{t("legal.privacy.sections.data.items.local")}</li>
            <li>{t("legal.privacy.sections.data.items.satellite")}</li>
            <li>{t("legal.privacy.sections.data.items.location")}</li>
            <li>{t("legal.privacy.sections.data.items.preferences")}</li>
          </ul>
          <p>{t("legal.privacy.sections.data.text2")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.processing.title")}</h3>
          <p>{t("legal.privacy.sections.processing.text")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.storage.title")}</h3>
          <p>{t("legal.privacy.sections.storage.text1")}</p>
          <p>{t("legal.privacy.sections.storage.text2")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.thirdParty.title")}</h3>
          <p>{t("legal.privacy.sections.thirdParty.text1")}</p>
          <ul>
            <li><strong>OpenStreetMap Nominatim</strong> — {t("legal.privacy.sections.thirdParty.items.nominatim")}</li>
            <li><strong>Esri</strong> — {t("legal.privacy.sections.thirdParty.items.esri")}</li>
            <li><strong>USGS / GDACS</strong> — {t("legal.privacy.sections.thirdParty.items.usgs")}</li>
            <li><strong>Microsoft Planetary Computer</strong> — {t("legal.privacy.sections.thirdParty.items.pc")}</li>
            <li><strong>Open-Meteo</strong> — {t("legal.privacy.sections.thirdParty.items.meteo")}</li>
            <li><strong>NASA, Copernicus, EUMETSAT, AWS Terrain Tiles, Source Cooperative</strong> — {t("legal.privacy.sections.thirdParty.items.layers")}</li>
            <li><strong>World Bank, UN OCHA Humanitarian API</strong> — {t("legal.privacy.sections.thirdParty.items.official")}</li>
            <li><strong>GitHub Pages</strong> — {t("legal.privacy.sections.thirdParty.items.github")}</li>
          </ul>
          <p>{t("legal.privacy.sections.thirdParty.text2")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.cookies.title")}</h3>
          <p>{t("legal.privacy.sections.cookies.text")}</p>
          <p><a href="#" onClick={(e) => { e.preventDefault(); openLegal("cookies"); }}>{t("legal.privacy.sections.cookies.link")}</a></p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.rights.title")}</h3>
          <p>{t("legal.privacy.sections.rights.text")}</p>
          <ul>
            <li>{t("legal.privacy.sections.rights.items.access")}</li>
            <li>{t("legal.privacy.sections.rights.items.delete")}</li>
            <li>{t("legal.privacy.sections.rights.items.object")}</li>
            <li>{t("legal.privacy.sections.rights.items.portability")}</li>
          </ul>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.children.title")}</h3>
          <p>{t("legal.privacy.sections.children.text")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.changes.title")}</h3>
          <p>{t("legal.privacy.sections.changes.text")}</p>
        </section>

        <section>
          <h3>{t("legal.privacy.sections.contact.title")}</h3>
          <p>{t("legal.privacy.sections.contact.text")}</p>
          <p><a href="https://github.com/moosarazauaf/earthpulse/issues" target="_blank" rel="noreferrer">GitHub Issues</a> · <a href="mailto:moosaraza@proton.me">Email</a></p>
        </section>
      </div>
    );
  }

  if (page === "cookies") {
    return (
      <div className="legal-content">
        <h2>{t("legal.cookies.title")}</h2>
        <p className="legal-updated">{t("legal.cookies.updated", { date: "2026-10-24" })}</p>

        <section>
          <h3>{t("legal.cookies.sections.what.title")}</h3>
          <p>{t("legal.cookies.sections.what.text")}</p>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.how.title")}</h3>
          <p>{t("legal.cookies.sections.how.text")}</p>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.categories.title")}</h3>
          <table>
            <thead>
              <tr><th>{t("legal.cookies.sections.categories.table.name")}</th><th>{t("legal.cookies.sections.categories.table.purpose")}</th><th>{t("legal.cookies.sections.categories.table.duration")}</th></tr>
            </thead>
            <tbody>
              <tr><td><code>earthpulse.places.v1</code></td><td>{t("legal.cookies.sections.categories.rows.places")}</td><td>{t("legal.cookies.sections.categories.rows.placesDur")}</td></tr>
              <tr><td><code>earthpulse.recent.v1</code></td><td>{t("legal.cookies.sections.categories.rows.recent")}</td><td>{t("legal.cookies.sections.categories.rows.recentDur")}</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.thirdParty.title")}</h3>
          <p>{t("legal.cookies.sections.thirdParty.text")}</p>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.manage.title")}</h3>
          <p>{t("legal.cookies.sections.manage.text1")}</p>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.changes.title")}</h3>
          <p>{t("legal.cookies.sections.changes.text")}</p>
        </section>

        <section>
          <h3>{t("legal.cookies.sections.contact.title")}</h3>
          <p>{t("legal.cookies.sections.contact.text")}</p>
        </section>
      </div>
    );
  }

  // Terms of Service
  return (
    <div className="legal-content">
      <h2>{t("legal.terms.title")}</h2>
      <p className="legal-updated">{t("legal.terms.updated", { date: "2026-10-24" })}</p>

      <section>
        <h3>{t("legal.terms.sections.acceptance.title")}</h3>
        <p>{t("legal.terms.sections.acceptance.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.service.title")}</h3>
        <p>{t("legal.terms.sections.service.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.data.title")}</h3>
        <p>{t("legal.terms.sections.data.text1")}</p>
        <ul>
          <li>{t("legal.terms.sections.data.items.satellite")}</li>
          <li>{t("legal.terms.sections.data.items.hazard")}</li>
          <li>{t("legal.terms.sections.data.items.osm")}</li>
        </ul>
        <p>{t("legal.terms.sections.data.text2")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.license.title")}</h3>
        <p>{t("legal.terms.sections.license.text1")}</p>
        <p><a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer">MIT License</a></p>
        <p>{t("legal.terms.sections.license.text2")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.usage.title")}</h3>
        <p>{t("legal.terms.sections.usage.text")}</p>
        <ul>
          <li>{t("legal.terms.sections.usage.items.lawful")}</li>
          <li>{t("legal.terms.sections.usage.items.noAbuse")}</li>
          <li>{t("legal.terms.sections.usage.items.noReverse")}</li>
          <li>{t("legal.terms.sections.usage.items.attribution")}</li>
        </ul>
      </section>

      <section>
        <h3>{t("legal.terms.sections.warranty.title")}</h3>
        <p>{t("legal.terms.sections.warranty.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.liability.title")}</h3>
        <p>{t("legal.terms.sections.liability.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.changes.title")}</h3>
        <p>{t("legal.terms.sections.changes.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.governing.title")}</h3>
        <p>{t("legal.terms.sections.governing.text")}</p>
      </section>

      <section>
        <h3>{t("legal.terms.sections.contact.title")}</h3>
        <p>{t("legal.terms.sections.contact.text")}</p>
      </section>
    </div>
  );
}

const LegalDialog = ({ page, onClose }: { page: LegalPage; onClose: () => void }) => {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, [page]);

  const titles = {
    privacy: t("legal.privacy.title"),
    cookies: t("legal.cookies.title"),
    terms: t("legal.terms.title"),
  };

  return createPortal(
    <dialog ref={dialog} className="sheet legal-sheet" aria-labelledby="legal-title" onClose={onClose}>
      <div className="row">
        <h2 id="legal-title">{titles[page]}</h2>
        <button className="ghost" onClick={onClose} aria-label={t("legal.close")}>×</button>
      </div>
      <LegalContent page={page} />
    </dialog>,
    document.body
  );
};

let openLegal: (page: LegalPage) => void;

export function LegalPages() {
  const legalOpen = useStore((s) => s.legalOpen);
  const set = useStore((s) => s.set);

  openLegal = (page: LegalPage) => set({ legalOpen: page });

  // Listen for custom events from footer links
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail === "privacy" || e.detail === "cookies" || e.detail === "terms") {
        set({ legalOpen: e.detail });
      }
    };
    window.addEventListener("open-legal", handler as EventListener);
    // ?legal=privacy (or cookies, terms) opens a page directly, so the policies can be linked to.
    const asked = new URLSearchParams(window.location.search).get("legal");
    if (asked === "privacy" || asked === "cookies" || asked === "terms") set({ legalOpen: asked, introOpen: false });
    return () => window.removeEventListener("open-legal", handler as EventListener);
  }, [set]);

  if (!legalOpen) return null;

  return <LegalDialog page={legalOpen} onClose={() => set({ legalOpen: null })} />;
}

export { openLegal };