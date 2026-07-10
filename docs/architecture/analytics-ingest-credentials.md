# Analytics ingest credential operations

Owned-analytics browser credentials are public containment controls, not
confidential client secrets. Give each credential only the games and
environments its client actually submits, retain the worker's rate limits, and
rotate through measured mobile overlap. Never widen claims to make a rollout or
rollback easier.

This runbook describes human release work. It does not authorize an agent or CI
job to mint credentials, change Cloudflare secrets, deploy the worker, or revoke
a live key.

## Structured secret contract

`ANALYTICS_INGEST_CREDENTIALS` is mandatory before ingest is enabled or the new
worker is deployed. Its value is a JSON array:

```json
[
  {
    "key": "<redacted-key-at-least-16-characters>",
    "games": ["marble_run"],
    "envs": ["production"]
  }
]
```

Every entry must have an unpadded key of at least 16 characters, at least one
lowercase `game_id` matching `[a-z0-9][a-z0-9_-]{0,63}`, and at least one of
`production`, `development`, or `test`. There are no game or environment
wildcards. Duplicate keys, including whitespace variants and duplicates with
otherwise malformed claims, poison that key for the entire configuration.

The worker distinguishes only sanitized configuration states:

- `missing`: the secret binding is absent;
- `empty`: the binding is present but empty or whitespace;
- `invalid`: JSON cannot be parsed or the top level is not an array;
- `loaded`: the top level is an array, which may still have zero accepted
  credentials if its entries are invalid.

Missing, empty, invalid, and empty-valid configurations all authenticate no
ingest clients. Malformed entries are dropped. `ANALYTICS_PUBLIC_CLIENT_KEYS`
is ignored by runtime authentication; it is only an offline migration inventory
input. `ANALYTICS_ALLOWED_GAME_IDS` remains a coarse deployment parser
allow-list and grants no credential scope.

## Migration preflight

The change record must name two humans before work begins:

- **Mobile release owner:** owns client releases, support-window evidence, and
  the final revoke decision.
- **Analytics/telemetry owner:** owns sanitized preflight evidence, adoption
  reporting, canary monitoring, and post-change metrics.

Record the actual names, ticket, target Wrangler environment, client versions,
claim set, timestamps, and approvals. Never copy raw keys into tickets, logs,
dashboards, or chat.

Run the following sequence independently for Wrangler `development`, `test`,
and `production`. Completion in one environment is not evidence for another.

1. Offline, inventory each value currently represented by
   `ANALYTICS_PUBLIC_CLIENT_KEYS` and determine its real game/environment use
   from release configuration. Convert each to the narrowest explicit
   `{ key, games, envs }` entry. Do not infer all environments from the coarse
   game allow-list.
2. Validate the candidate JSON with an approved local preflight that invokes
   the same parser contract. Record only `configState`, accepted-entry count,
   malformed-entry count, and duplicate-canonical-key count. The required
   result is `loaded`, the expected accepted count, and zero malformed or
   duplicate entries.
3. Store the candidate and a previous narrow payload in the approved encrypted
   secret manager as the rollback payload. Access must be limited to the named
   release operators.
4. Set the scoped secret for exactly one target environment; do not paste the
   value on the command line or into this repository:

   ```sh
   wrangler secret put ANALYTICS_INGEST_CREDENTIALS --env <environment>
   ```

5. In an approved dry-run or environment-specific canary, verify one
   in-scope request succeeds and game-only, environment-only, and combined
   mismatches all return the same `403 forbidden_scope`. Confirm logs and
   metrics contain only `game_id`, `env`, and the sanitized scope reason.
6. Only after the secret preflight and rollback payload are recorded may the
   release owner approve enabling or deploying the new worker in that
   environment. Recheck normal ingest volume, unauthorized responses,
   `forbiddenScopeGame`, and `forbiddenScopeEnv` after the change.

Setting a legacy flat key while the scoped secret is missing, empty, or invalid
will not preserve ingest. That fail-closed behavior is intentional; correct the
scoped secret or use the saved narrow rollback payload.

## Mobile-safe rotation

Rotate one Wrangler environment at a time and keep its evidence separate.
Call the existing narrow key `Ko` and its replacement `Kn`.

1. Generate `Kn` through the approved human secret process. Give it the same
   or narrower game/environment claims as `Ko`.
2. Add `Kn` beside `Ko` in the scoped registry, preserving `Ko`'s narrow entry.
   Save that overlap registry and the prior narrow registry as encrypted
   rollback payloads.
3. Set the target environment's secret, deploy through the normal human release
   process, and canary both credentials. Confirm accepted ingest and scope
   denial metrics remain within the recorded baseline.
4. Release supported mobile client versions configured with `Kn`. Measure
   adoption from app-version/release-dashboard telemetry, never by logging raw
   credential values.
5. Keep both keys valid for at least 30 days **or the longer published client
   support window**, and until both adoption gates are met:
   - at least 99% of 14-day active supported clients run versions configured
     with `Kn`; and
   - no supported version remains that can submit only with `Ko`.
6. The mobile release owner and analytics/telemetry owner record the evidence
   and jointly approve revocation. Remove `Ko` in a second secret update and
   deployment, then canary `Kn` and monitor accepted volume, unauthorized
   responses, both forbidden-scope counters, and error rate.

Do not revoke solely because 30 days elapsed. A longer support promise or an
unmet adoption gate extends overlap.

## Rollback

If monitored ingest regresses after revocation, restore the saved payload that
adds the original **narrow** `Ko` entry beside `Kn`, then redeploy through the
normal human release process for that environment. Verify both keys and the
same denial probes, and continue monitoring. Rollback never restores flat
runtime auth, adds a wildcard, copies production claims to development/test, or
widens any game/environment grant.

Repeat remediation and evidence collection independently in development, test,
and production. Actual issuance, secret changes, rotation, revocation, rollback,
and deployment always remain a human release follow-up.
