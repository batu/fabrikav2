# 2026-09-03 — three alternative main-character styles

Batu: "3 alternative main character styles. 1 forge master simple style, 1 top
down hat and wand appearing like the one in the reference, and the third one
kingdom rush gameplay style. first get a reference image for all and then generate".

References (all in this folder): Forge Master App Store gameplay shot
(`ref-1`), the game's own storyboard `refs/art/layout-reference.jpeg`
(`ref-2`, the tiny top-down mages), the Kingdom Rush gameplay image from
Wikipedia (`ref-3`, only 325×244 available). Identity reference: the current
three unit sprites side by side (`ref-0`).

Generated with `fal-ai/nano-banana/edit` (style reference + party reference,
one prompt per style; prompts in the session log). Three calls.

- `1-forge-master-style.png` — flat vector, big heads, minimal shading. Faithful.
- `2-topdown-hat-wand-style.png` — hat-dominant top-down figures with the wand
  out past the brim, matching the storyboard silhouettes.
- `3-kingdom-rush-style.png` — chunky three-quarter units with thick outlines;
  the model dropped Bastion's lightning staff (raised empty hand) — regenerate
  that one if this style is chosen.

`style-comparison.png` puts each reference beside its result. Nothing is
wired into the game; this is a direction pick.

## Round 2 — regenerated with codex (Batu: "no use codex please")

`1-…`, `2-…`, `3-…` are now the codex image tool results (`codex exec -i <style ref> -i
<party ref>`, gpt image model, #333333 matte). The fal Nano Banana versions are kept as
`fal-*.png` for the record. Codex's Forge Master set is a simplified chibi rather than
a true flat vector; the Kingdom Rush set fixed the missing staff. Portal: stream
`mage-master`, second report post.
