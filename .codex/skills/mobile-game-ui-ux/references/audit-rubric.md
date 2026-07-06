# Mobile Game UI/UX Audit Rubric

Score each area 1-5 before coding. Anything below 4 needs either a fix or an explicit reason it is out of scope.

| Area | 1 means | 5 means |
|---|---|---|
| First 30 seconds | player cannot start or understand next action | player starts, learns, and succeeds without explanation |
| Touch ergonomics | small, crowded, edge-hostile controls | primary controls are large, reachable, and hard to mis-tap |
| HUD readability | state is hidden, tiny, or covers play | score, lives, timer, level, and resources are readable at phone size |
| Gameplay focus | UI competes with the playfield | UI supports the playfield and disappears when not needed |
| Feedback | actions feel silent or delayed | every tap, success, fail, and blocked action responds immediately |
| Flow momentum | menus, fail states, or ads strand the player | retry, continue, win, and next-level paths are obvious and quick |
| Responsive canvas | desktop layout is merely shrunk | canvas, HUD, and overlays adapt to viewport, DPR, safe area, and orientation |
| Evidence | no mobile screenshot or test | mobile viewport plus behavior proof; real device when available |

## Audit Output

Use this format:

```text
MOBILE GAME UI/UX AUDIT - <game/surface>
First 30 seconds: 3/5 - <why>
Touch ergonomics: 2/5 - <why>
HUD readability: 4/5 - <why>
Gameplay focus: 3/5 - <why>
Feedback: 2/5 - <why>
Flow momentum: 4/5 - <why>
Responsive canvas: 3/5 - <why>
Evidence: 1/5 - <why>

Priority fixes:
1. <highest player-impact fix>
2. <next fix>
3. <next fix>
```

Prefer three strong fixes over a broad cosmetic pass.
