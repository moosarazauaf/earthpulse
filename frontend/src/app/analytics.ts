/**
 * Visit counting with Umami Cloud, a cookie-free analytics service: it records
 * the page, referrer, browser, device type and country (worked out from the
 * IP address, which is not stored), so the author can see how many people use
 * EarthPulse now and over time. Off unless the build sets
 * VITE_UMAMI_WEBSITE_ID; visitors with Do Not Track on are never counted.
 */
const ID = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
/** Umami website IDs are UUIDs; anything else is a misconfiguration and is ignored. */
const VALID = !!ID && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ID);

export const ANALYTICS_ON = VALID && import.meta.env.PROD;

export function startAnalytics() {
  if (!ANALYTICS_ON) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://cloud.umami.is/script.js";
  script.dataset.websiteId = ID!;
  script.dataset.doNotTrack = "true";
  // Count only the live site, never local development or previews.
  script.dataset.domains = "moosarazauaf.github.io";
  document.head.appendChild(script);
}
