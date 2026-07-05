// Phantom dependencies: neither package is declared in badgame/package.json.
// The single-quoted import is exactly what v1's grep-affected-games.sh MISSED
// (it only matched double quotes) — this fixture regression-guards that bug.
import { version } from '@fabrikav2/kernel';
import { render } from "@fabrikav2/ui";

export const boot = () => render(version);
