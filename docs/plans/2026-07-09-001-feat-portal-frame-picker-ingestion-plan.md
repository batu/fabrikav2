---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
date: 2026-07-09
---

# Portal Interactive Views + Wool Crush Reference Ingestion - Plan

## Goal Capsule

**Objective.** Make reference ingestion for new game clones a collaborative
AI+human step: a screen recording of the reference game goes in, a curated,
labeled set of reference frames comes out — selected together via a Portal-hosted
frame-picker view. Wool Crush is the first live run; the deeper goal is
validating the UI/design pipeline seams (video → refs → ai_asset → design-sheets
→ Claude Design → fabrikav2 template).

**Product authority.** Batu. Architecture verdict from this brainstorm: Portal
is the go-to AI↔human communication infrastructure; interaction UXes are views
built on top of it, not features baked into it.

**Open blockers.** Wool Crush screen recording (Batu is capturing it now).

## Product Contract

### Decisions

1. **Portal = substrate, views = producers' code.** Portal core provides auth,
   streams, media storage (videos fit under the existing 200MB soft cap),
   verdict persistence with `portal wait`, and doorbell notification. It never
   learns view-specific semantics (e.g. what a "frame" is).
2. **New Portal primitive: interactive view post.** A decision-flavored post
   whose body is a producer-supplied self-contained HTML file, served with
   scripts enabled (current report CSP is `sandbox allow-same-origin`, no JS —
   the one missing piece). The view submits an **opaque JSON verdict** through a
   cookie-authenticated browser twin (same pattern as `/s/<slug>/answer`);
   agents retrieve it via the existing verdict machinery. Verdict schema
   ownership sits with the view's producer, not Portal.
3. **First view: frame-picker.** Video element + timeline; agent-suggested
   markers pre-baked into the HTML; human can drop suggestions, scrub and add
   missed frames, and label each kept frame with a canonical state (menu,
   level, win, fail, settings, pause — the refs/manifest vocabulary).
   Verdict payload is `{frames: [{t, label, source: agent|human}]}` —
   timestamps only; pixel extraction happens tool-side afterward (ffmpeg),
   never in the browser.
4. **Ingestion tool (next slice, not this one).** Deterministic halves:
   ffmpeg scene-change candidates + phash dedup (borrow refcap-compare's
   in-tree phash) → build/post the view → wait → extract chosen frames →
   write `games/<g>/refs/art/` + `refs/manifest.yaml` entries with
   state/provenance/at-rest metadata per the refs-lint contract. Agent owns
   the loop; the tool returns.

### In scope (this slice)

- Portal: interactive view post type + scripted-HTML serving + generic verdict
  submit/read; `portal` CLI support for posting a view with assets.
- The frame-picker view HTML (works when posted with a video asset + marker
  JSON baked in).
- Live proof: post a real view with a sample video, pick frames on the phone,
  read the verdict back via CLI.

### Out of scope (this slice)

- The full ingest tool, ai_asset/design-sheets wiring, and the Wool Crush game
  itself (follow-on slices of the same run).
- Portal public exposure / multi-user auth. Hosted-JS-on-authed-origin is
  accepted for single-user tailnet use; revisit before any public tunnel.
- Verdict schema validation inside Portal (deliberately opaque).

### Success criteria

- A frame-picker posted to a stream renders on the phone, plays the video,
  shows agent markers, and lets the human add/remove/label frames.
- `portal wait <id>` returns the frame verdict JSON unchanged.
- Existing report/decision posts still serve script-blocked (no CSP
  regression for non-view posts).

### Assumptions

- "UI is the biggest bottleneck" is taken from Batu's testing experience,
  not re-validated here.
- Wool Crush's loop/genre details are deferred to the recording + a gameplay
  explanation Batu will supply; they don't change this slice.
