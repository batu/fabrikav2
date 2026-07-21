# Prompt research — premium-casual asset generation (2026-07-16)

Sources: ai_asset `style_tokens/` (the distilled "Casual Style Dictionary" +
Banana2 icon guide) and a web pass over OpenAI Cookbook, Google Cloud's Nano
Banana guide, and practitioner match-3/sprite-sheet writeups. Grounds the
gold-standard `style-guide.json` and the pipeline's prompt/background
handling. Key decisions:

## Per-model-family behavior (encoded in pixelsmith)

- **gpt-image: NEVER write "transparent background" in a prompt** — the model
  paints a literal checkerboard. Real alpha comes only from the API
  `background: "transparent"` parameter. (OpenAI community + fal.ai guide.)
  → pixelsmith passes the param for `openai/*` and keeps prompts silent about
  transparency. Note: third-party reports claim gpt-image-2 dropped the
  param — the shakedown batch verifies (plan AE4); the matting fallback
  covers it if true.
- **Gemini image models output no alpha.** Best matting substrate is a flat
  mid-grey `#333333` backdrop (keeps rim light/glow visible, absent from
  asset palettes, removes cleanly). → pixelsmith appends the
  `MATTE_BACKGROUND_SUFFIX` for transparent specs on non-OpenAI models and
  the alpha pipeline mats + defringes it out.
- **Prompt shape:** gpt-image is format-agnostic (labeled segments fine);
  Gemini wants narrative prose, positive framing over negations. Our prose
  prompts with a short Avoid tail sit in the intersection.
- **Hex fidelity is approximate on subjects** (holds better on backgrounds).
  The color locks steer; the pick-loop and downstream color-grade correct.
  Don't expect exactness (no credible benchmark exists).

## Style vocabulary (encoded in style-guide.json)

- Core casual-tier trick: **"stylized baked texture look"** — hand-painted
  lighting baked onto clean 3D-like volumes (semi-painted, not photoreal 3D).
- Icons: "glossy sculpted, airbrushed polish, flawless smooth gradients";
  currency: "polished gold, rich precious sheen"; shapes: "rounded,
  hand-rolled silhouettes with subtle asymmetry" (avoid sterile geometry);
  practitioner tier-words: "modern, vibrant, highly polished, smooth rounded
  edges, sharp internal details".
- Backfire words: "photorealistic", "real photograph", camera/lens terms,
  "octane/render" — photorealism triggers; keep out. Don't pile associated
  words ("vinyl toys" drags in a whole package).
- Mood: "premium, satisfying, high-value feel".

## Lettering (the canary slot)

- Both families handle 1–3 word strings; gpt-image is currently more
  reliable at character-level precision. Quote the exact string, describe the
  treatment as material + layout ("arched golden 3D lettering with white
  outline and glossy bevel"), never font names.

## Sheets

- Name the grid strictly, assign cells, demand "identical style, identical
  proportions, identical lighting in every cell", and leave spacing headroom
  so glow/shadow never touches a neighbor (all encoded in pixelsmith's sheet
  prompt). Known failure modes: repeated cells, identity drift, baseline
  misalignment — fewer cells per sheet is the mitigation; slicing already
  trusts alpha-trim, not exact cell geometry.

## Later evaluation

`style-guide.ingest-baseline.json` is the raw `pixelsmith ingest` output from
the same refs; compare future ingest improvements against the hand-authored
gold standard in `style-guide.json`.
