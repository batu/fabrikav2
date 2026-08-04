# Task NAV-1 - Lower bottom navigation content

### Status

passed

### Goal

Move the Achievements, Shop, and Settings icon-label groups down exactly 20 CSS pixels.

### Why Now

The current revision places both icons and labels too high within their illustrated cells.

### User Lens

The navigation should read as content seated inside each cream tile, not perched near its top edge.

### Pre-Shot Targets

- Default home screen at 390x844.
- Compact home screen at 375x667.

### Repro Setup

- Route: Find the Bird test home state.
- Viewports: 390x844 and 375x667.
- Fixture: deterministic home-navigation capture script.
- State: default home screen.

### Acceptance Criteria

- All three icons move down 20 CSS pixels.
- All three labels move down 20 CSS pixels.
- The three icons and labels retain their exact shared alignment and remain inside the navigation bar.

### Expected Visual Result

Each icon-label group sits 20 pixels lower as one unit, with unchanged horizontal centering.

### Constraints

- Do not resize the artwork or text.
- Do not move the Play Now button or change navigation behavior.

### Out of Scope

- Other home-screen spacing and asset changes.

### Verification

- Compare matching 390x844 and 375x667 before/after screenshots.
- Run the home UI unit suite and TypeScript check.

### Spawn Rules

- If the lower position exposes a separate border defect, record it instead of changing unrelated assets.
- If acceptance is partial, append another iteration to this task.
