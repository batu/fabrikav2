# Google Ads API re-review draft

Status: draft only; not submitted or sent  
Source assessment: `/Users/base/dev/appletolye/personal_site/docs/reports/2026-08-25-google-ads-api-application-gap.md`

## Correct route

1. Follow any case-specific resubmission instruction in the rejection email or API Center.
2. If no usable resubmit action exists, use Google's official **Contact Google Ads API Compliance** form and select **Rejection**.
3. Do not create another developer token as a workaround.

Known application identity from the original successful submission:

- MCC: `232-701-7574`
- API contact: `baseardahan@gmail.com`
- Primary site: `https://basegamelab.com/`
- Tool page: `https://basegamelab.com/ads-operations/`
- Requested level: Basic Access
- Scope: App campaigns; campaign creation, campaign management, and reporting; internal first-party use only

The current API Center status, submitted URL fields, and rejection case state remain unverified. The cached Google Ads OAuth grant belongs to a retired/rotated OAuth client and cannot refresh (`invalid_client`); the current client has AdMob scopes but needs a fresh `adwords` authorization before API access can be probed.

## Details to verify before submission

- Token access level/status: initial, Test/Explorer, Basic, or Standard
- MCC ID holding the developer token
- API contact email is current and monitored
- Company URL exactly equals the intended live public URL
- Tool/application URL points to the live Ads Operations page
- Application describes internal first-party use for Base Game Lab-owned accounts
- Requested functionality matches actual campaign creation/management/reporting behavior
- Active Ads accounts are linked to the token-holding manager account where required

## Proposed rejection-case description

> Base Game Lab requests a fresh review of its Google Ads API application. The public company website now directly documents the internal first-party application, Base Game Lab Ads Operations, at https://basegamelab.com/ and https://basegamelab.com/ads-operations/.
>
> These pages describe the application's business purpose, its restricted users (Base Game Lab employees and authorized contractors), its Base Game Lab-owned Google Ads account boundary, and its App campaign creation, management, monitoring, and reporting workflows. The application is not offered to clients, other advertisers, or the public.
>
> Application-specific privacy and terms pages are available at https://basegamelab.com/google-ads-api/privacy and https://basegamelab.com/google-ads-api/terms. A first-party product page is available at https://basegamelab.com/find-the-bird.
>
> The relevant pages are publicly accessible without authentication. Please perform a fresh review of the URLs and application information. We are available to provide additional implementation or demo evidence if requested.

## Credential incident

While inspecting oauth2l cache metadata, one diagnostic command printed OAuth client-secret values into the private agent-session tool output. No secret was committed, added to an artifact, or sent externally. Batu was notified on Telegram. The affected OAuth client must be rotated/deleted after explicit approval; until then, treat it as exposed.

## Submission gate

Before any form submission or email, present:

- destination/recipient,
- subject or form issue type,
- purpose,
- final body summary,
- all account identifiers that will be disclosed.

Then ask for explicit approval. This draft is not authorization to submit it.
