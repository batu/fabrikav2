# Wool Crush asset-generation cost ledger

Budget ceiling: **$15.00 USD total**. Generation stopped when OpenRouter returned HTTP 402.

Record one row per Pixelsmith job (one model × one variant). Copy the
`cost_estimate_usd`, model, output path, and provenance sidecar values from the
JSON emitted by `pixelsmith generate`; replace the estimate with billed cost if
the provider exposes it. Never infer a lower billed cost.

| UTC timestamp | Slot/spec | Model | Variant | Candidate output | Estimated USD | Billed USD | Cumulative USD | Portal request | Decision / notes |
|---|---|---|---|---|---:|---:|---:|---|---|
| 2026-07-16 22:08–22:16 | coin retry failures | mixed / OpenAI | mixed | none installed | 1.20 | unknown | 1.20 | — | Conservative estimate for three alpha/matting-failed attempts; provider did not return billed cost |
| 2026-07-16 22:17 | coin | Gemini 3.1 Flash Image | sunny + premium | `coin-*.png` | 0.24 | unknown | 1.44 | req_052816 | sunny picked |
| 2026-07-16 22:17 | hint | Gemini 3.1 Flash Image | loop + hook | `hint-*.png` | 0.24 | unknown | 1.68 | req_0858f8 | loop picked |
| 2026-07-16 22:18 | nav icons | Gemini 3.1 Flash Image | plush + graphic sheets | `nav-icons-*` | 0.12 | unknown | 1.80 | req_d8c3ba | graphic family picked |
| 2026-07-16 22:19 | saga nodes | Gemini 3.1 Flash Image | spool + cushion sheets | `saga-nodes-*` | 0.24 | unknown | 2.04 | req_4641c3 | spool family picked |
| 2026-07-16 22:20 | title card | Gemini 3.1 Flash Image | plush + stitched | `title-card-*.png` | 0.24 | unknown | 2.28 | req_4641c3 | plush picked |
| 2026-07-16 22:21 | coin tiers | Gemini 3.1 Flash Image | cozy + clean sheets | `coin-tiers-*` | 0.24 | unknown | 2.52 | req_c37ee0 | cozy picked |
| 2026-07-16 22:22 | hint tiers | Gemini 3.1 Flash Image | fan + bundle sheets | `hint-tiers-*` | 0.24 | unknown | 2.76 | req_c37ee0 | bundle picked |
| 2026-07-16 22:23 | no ads | Gemini 3.1 Flash Image | felt + yarn | `no-ads-*.png` | 0.24 | unknown | 3.00 | req_c37ee0 | yarn picked |
| 2026-07-16 22:24 | premium no ads | Gemini 3.1 Flash Image | crest + bundle | `no-ads-premium-*` | 0.24 | unknown | 3.24 | req_c37ee0 | crest picked |
| 2026-07-16 22:25 | result titles | Gemini 3.1 Flash Image | 4 candidates | `level-complete-*`, `out-of-lives-*` | 0.72 | unknown | 3.96 | req_c37ee0 | clean ribbons picked |
| 2026-07-16 22:26 | result marks | Gemini 3.1 Flash Image | plush + graphic sheets | `marks-*` | 0.24 | unknown | 4.20 | req_c37ee0 | plush pair picked |
| 2026-07-16 22:27 | pattern motif | Gemini 3.1 Flash Image | planned | none | 0.00 | 0.00 | 4.20 | — | HTTP 402 insufficient credits; shipped as hand-tuned CSS mask per priority rule |

## Budget control

- Before every call: `remaining = 15.00 - cumulative billed (or estimated when billed is unknown)`.
- Pass that exact remaining amount as `--max-cost`; Pixelsmith applies it to the full model × variant fan-out.
- Stop before a call whose reported estimate exceeds the remaining budget.
- If budget pressure requires cuts, preserve this order: yarn-ball currency and crochet-hook hint → nav and saga → Wool Crush title → result/title marks → pattern motif.
- The pattern motif ultimately ships as a hand-tuned monochrome SVG/CSS mask; generation is reference-only and should be skipped first.

## Summary

| Category | Estimated USD | Billed USD |
|---|---:|---:|
| Failed attempts (conservative) | 1.20 | unknown |
| Economy identity | 1.20 | unknown |
| Nav and saga | 0.36 | unknown |
| Title and result lettering | 1.20 | unknown |
| Marks and motif | 0.24 | unknown |
| **Total** | **4.20** | **unknown** |
| **Remaining against cap** | **10.80** | **unknown** |
