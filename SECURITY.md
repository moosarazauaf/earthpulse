# Security

## Reporting

Please report vulnerabilities privately through GitHub's
"Report a vulnerability" button on the repository's Security tab, not in a
public issue.

## How the application is built to fail safely

- **No secrets in the client.** The browser only ever talks to the EarthPulse
  API. Credentials for optional backends (for example Earth Engine) are read
  from environment variables on the server.
- **No server-side fetching of caller-supplied URLs.** Every outbound request
  goes to a host on a fixed allowlist in `backend/app/core/http.py`. Asset
  links returned by a catalogue are checked against the same list before they
  are opened, which closes the usual SSRF path.
- **Validated input.** Requests are parsed into strict Pydantic models. AOI
  geometry is checked for validity, coordinate range and maximum area before
  any imagery is requested.
- **Rate limiting** on the analysis and tile endpoints.
- **Sanitised errors.** Clients receive a short message and a stable error
  code; stack traces and upstream responses stay in the server log.
- **No personal data.** There are no accounts in the MVP and the analysis
  store holds only the AOI, parameters and results of each run.
