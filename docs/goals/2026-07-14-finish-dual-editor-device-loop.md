# Finish the Dual Editor Device Loop

## Goal

Finish the Fabrikav2 dual-editor evaluation as quickly as reliability allows by proving both complete vertical slices:

1. Make a visible shell change in GrapesJS, save and publish it, apply the accepted publication to the Fabrika runtime, and observe that exact change on the connected physical device.
2. Repeat the same acceptance test from the real Phaser Editor project and Phaser-native runtime.
3. Leave both workflows reproducible, committed through their TWF card worktrees, linked through Portal, and summarized with an evidence-based comparison.

## Priority Rule

Until both vertical slices pass on-device, prioritize only work that directly closes the path:

`editor authority -> validate -> immutable publish -> apply -> runtime -> physical device -> captured proof`

Cosmetic polish, speculative abstractions, broad refactors, extra editor features, and production migration are deferred unless they block this path.

## Definition of Done

- A human-visible GrapesJS edit is present in its accepted immutable publication and is independently observed on the physical device.
- A human-visible Phaser Editor edit is present in its accepted immutable publication and is independently observed on the physical device.
- Neither proof depends on hand-editing generated runtime presentation.
- Each lane has one documented, repeatable command sequence from saved editor state to device observation.
- Relevant focused and integration checks pass, and device evidence records the exact publication/revision identity.
- Work is committed and handed off through the correct TWF card worktrees; Portal points to the current test/evidence surfaces.
- The comparison states observed advantages, disadvantages, remaining risks, and a recommendation without introducing a third visual authority.

## Current Critical Path

1. Complete GrapesJS immutable apply and runtime selection.
2. Generate/configure the native shell and prove GrapesJS on-device.
3. Complete Phaser immutable apply and make the Phaser runtime boot its generated projection.
4. Prove Phaser on-device using the same acceptance test.
5. Consolidate evidence and evaluation only after both device loops work.
