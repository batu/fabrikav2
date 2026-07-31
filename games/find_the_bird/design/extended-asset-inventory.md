# Cozy Garden 3D extended UI inventory

The original 41-slot list covered iconography and major product art but omitted
the shared surfaces that determine whether the assembled game actually reads as
one visual system.

## New raster assets

- `nav-bar-3`: active home navigation shell; three equal bays.
- `nav-bar-4`: reusable four-destination shell.
- `nav-bar-5`: reusable five-destination shell.
- `achievement-completion`
- `achievement-birds`
- `achievement-mastery`
- `achievement-progression`
- `achievement-streak`
- `background-feather`: shared existing motif, installed as a runtime asset.

## Token-driven surfaces

These remain live text and semantic HTML. Cozy Garden styling is implemented
through theme tokens and component CSS rather than text-bearing bitmap buttons:

- primary, secondary, icon, pressed and disabled buttons;
- Next, Claim and rewarded Claim 2x;
- Continue, replay/restart, rescue and close actions;
- shop buy/restore actions and settings footer actions;
- modal cards, unavailable/empty states and achievement cards;
- achievement progress track, state chips and category headings.

This keeps localization, accessibility, disabled states, loading labels and
responsive sizing intact while ensuring every adjacent control uses the same
painted-wood, canvas, sage, sky-blue and peach material system.
