"""Outbound HTTP, restricted to a fixed set of hosts.

The server never fetches a URL chosen by a caller. Catalogue responses do
contain asset URLs, so those are checked here before anything opens them.
"""
from urllib.parse import urlsplit

import httpx

from app.core.errors import UpstreamUnavailable

# Exact hosts the API itself calls.
ALLOWED_HOSTS = frozenset(
    {
        "planetarycomputer.microsoft.com",
        "nominatim.openstreetmap.org",
    }
)
# Planetary Computer assets live in Azure blob storage accounts.
ALLOWED_HOST_SUFFIXES = (".blob.core.windows.net",)

USER_AGENT = "EarthPulse/0.1 (+https://github.com/moosarazauaf/earthpulse)"

_client: httpx.Client | None = None


def is_allowed_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host:
        return False
    return host in ALLOWED_HOSTS or host.endswith(ALLOWED_HOST_SUFFIXES)


def require_allowed(url: str) -> str:
    if not is_allowed_url(url):
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
    return url


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            timeout=httpx.Timeout(60.0, connect=10.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=False,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )
    return _client


def request(method: str, url: str, **kwargs) -> httpx.Response:
    """Send a request to an allowlisted host, mapping failures to a safe error."""
    require_allowed(url)
    try:
        response = client().request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.") from exc
    if response.status_code >= 500:
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
    return response
