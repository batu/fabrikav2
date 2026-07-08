# Block Blast - design brief

Game id: `block_blast`

This brief captures the first-pass design contract for the v2 port.

## What it is
Block Blast is a compact 8x8 block-placement puzzle. Players choose one of three
pieces, place it on the board, clear full rows or columns, and survive the
procedural ramp. V2 keeps endless play and adds a staged saga where each node
pins the existing generator dials to a seeded objective.

## Feel
Readable, crisp, tactile, escalating. The first pass favors clear board state and
fast retry over decorative effects; motion/juice remains a follow-up after device
captures.

## Constraints
Android WebView is the target lane. The bundle id is
`com.basegamelab.block_blast.dev`. Do not replace the seeded stage objectives
with random-hope progression; harness wins and failures must remain
deterministic.
