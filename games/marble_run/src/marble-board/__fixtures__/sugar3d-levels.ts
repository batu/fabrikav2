/**
 * VENDORED TEST FIXTURE — the 20 committed sugar3d levels, copied verbatim
 * from `games/marble_run/sugar3d/src/levels/levels.generated.ts` with only
 * the type import repointed at core's own `../types`.
 *
 * `packages/core` cannot import from a game tree (games depend on core, never
 * the reverse), so the calibration corpus is vendored rather than imported.
 * Regenerate by re-copying that file if the sugar3d level set changes.
 */
import type { LevelDef } from '../types';

export const LEVELS: readonly LevelDef[] = [
  {
    "id": 1,
    "cols": 4,
    "rows": 4,
    "cells": [
      "B...",
      "..RB",
      "...R",
      "R.B."
    ],
    "gates": [
      {
        "side": "top",
        "index": 1,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 2,
        "color": "blue"
      }
    ]
  },
  {
    "id": 2,
    "cols": 5,
    "rows": 5,
    "cells": [
      ".B.B.",
      ".B...",
      ".B.R.",
      "RBR.R",
      "...RR"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "blue"
      },
      {
        "side": "left",
        "index": 2,
        "color": "red"
      }
    ]
  },
  {
    "id": 3,
    "cols": 5,
    "rows": 6,
    "cells": [
      "R...R",
      "B.R.G",
      "B....",
      "..BR.",
      "B...R",
      "RBBRG"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "green"
      },
      {
        "side": "left",
        "index": 2,
        "color": "red"
      },
      {
        "side": "right",
        "index": 3,
        "color": "blue"
      }
    ]
  },
  {
    "id": 4,
    "cols": 6,
    "rows": 6,
    "cells": [
      "....B.",
      "..B.B.",
      "R...B.",
      ".R..BG",
      "GRBRBG",
      "G.RRRR"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "green"
      },
      {
        "side": "right",
        "index": 2,
        "color": "blue"
      }
    ]
  },
  {
    "id": 5,
    "cols": 6,
    "rows": 7,
    "cells": [
      "RR..R.",
      "G...BR",
      "GB..GG",
      "BRGR..",
      ".RG..G",
      ".BRB..",
      ".BRG.B"
    ],
    "gates": [
      {
        "side": "top",
        "index": 1,
        "color": "blue"
      },
      {
        "side": "bottom",
        "index": 4,
        "color": "blue"
      },
      {
        "side": "left",
        "index": 3,
        "color": "red"
      },
      {
        "side": "right",
        "index": 3,
        "color": "green"
      }
    ]
  },
  {
    "id": 6,
    "cols": 6,
    "rows": 7,
    "cells": [
      "#...B#",
      "B.R.B.",
      "R.BRBG",
      "G.R.BG",
      ".GGGBR",
      "R.RBGB",
      "#G...#"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "green"
      },
      {
        "side": "left",
        "index": 3,
        "color": "blue"
      }
    ]
  },
  {
    "id": 7,
    "cols": 7,
    "rows": 7,
    "cells": [
      "GGR.G.B",
      "RG...YG",
      "YB..GRB",
      "YBY...Y",
      "BRG.RG.",
      "..RBYY.",
      "G...R.R"
    ],
    "gates": [
      {
        "side": "top",
        "index": 3,
        "color": "yellow"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "red"
      },
      {
        "side": "left",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 3,
        "color": "green"
      }
    ]
  },
  {
    "id": 8,
    "cols": 7,
    "rows": 8,
    "cells": [
      "..GG...",
      "G..Y..G",
      "GRGBR.G",
      ".RGXYB.",
      "GBGXRYG",
      "GBR.YRB",
      "Y...Y..",
      "GB.B.BR"
    ],
    "gates": [
      {
        "side": "top",
        "index": 1,
        "color": "green"
      },
      {
        "side": "top",
        "index": 5,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "left",
        "index": 4,
        "color": "yellow"
      }
    ]
  },
  {
    "id": 9,
    "cols": 7,
    "rows": 8,
    "cells": [
      "BBBYGGB",
      ".RRB..B",
      "YB.G..B",
      "G.###.G",
      "GR###BY",
      ".BYYG.B",
      "...BBGB",
      "R.....G"
    ],
    "gates": [
      {
        "side": "top",
        "index": 3,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "green"
      },
      {
        "side": "left",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 4,
        "color": "yellow"
      }
    ]
  },
  {
    "id": 10,
    "cols": 7,
    "rows": 9,
    "cells": [
      "G.RG.YY",
      "GR.GG..",
      "..BYBBR",
      "R....R.",
      ".GYGG.Y",
      "GRG.R..",
      "YBBYB.B",
      "YYYBR..",
      "Y.BY..G"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "blue"
      },
      {
        "side": "top",
        "index": 4,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 1,
        "color": "yellow"
      },
      {
        "side": "bottom",
        "index": 5,
        "color": "green"
      },
      {
        "side": "right",
        "index": 4,
        "color": "blue"
      }
    ]
  },
  {
    "id": 11,
    "cols": 8,
    "rows": 9,
    "cells": [
      "R...RGR.",
      ".PB.B.RB",
      ".GR...PY",
      "R.PB..YP",
      "B.P.R.P.",
      ".YYB.BRP",
      ".R.YP..Y",
      "BYYBGPB.",
      "P.PGGR.R"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "purple"
      },
      {
        "side": "top",
        "index": 5,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "green"
      },
      {
        "side": "left",
        "index": 4,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 4,
        "color": "yellow"
      }
    ]
  },
  {
    "id": 12,
    "cols": 8,
    "rows": 9,
    "cells": [
      "#BY.GG.#",
      "RRR..R.B",
      "PB..GRG.",
      "..RP.PRG",
      "Y.PXX.BY",
      ".PBP.GYG",
      "G.YBYB.Y",
      ".RRGG...",
      "#Y.R.B.#"
    ],
    "gates": [
      {
        "side": "top",
        "index": 3,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 4,
        "color": "purple"
      },
      {
        "side": "left",
        "index": 3,
        "color": "green"
      },
      {
        "side": "right",
        "index": 5,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 2,
        "color": "yellow"
      }
    ]
  },
  {
    "id": 13,
    "cols": 8,
    "rows": 10,
    "cells": [
      "PB.RPG.G",
      "R.Y..PPR",
      "PRY..R..",
      ".Y.GP..R",
      "BRPPYYPB",
      "YP.G.Y.R",
      "...PG.P.",
      "R..GBP.R",
      ".R....YR",
      "GRBBG.YP"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "blue"
      },
      {
        "side": "top",
        "index": 5,
        "color": "green"
      },
      {
        "side": "bottom",
        "index": 2,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 5,
        "color": "yellow"
      },
      {
        "side": "left",
        "index": 5,
        "color": "purple"
      },
      {
        "side": "right",
        "index": 4,
        "color": "green"
      }
    ]
  },
  {
    "id": 14,
    "cols": 8,
    "rows": 10,
    "cells": [
      "..R..P..",
      ".PBB.GRY",
      ".RRBP.RR",
      "R.XBGX.Y",
      ".PYBRYYR",
      "RYG.GPY.",
      "BGXB.X..",
      "..YR.PBP",
      "BPBYBRBY",
      "YR.PR..G"
    ],
    "gates": [
      {
        "side": "top",
        "index": 4,
        "color": "yellow"
      },
      {
        "side": "bottom",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "left",
        "index": 2,
        "color": "red"
      },
      {
        "side": "left",
        "index": 7,
        "color": "green"
      },
      {
        "side": "right",
        "index": 5,
        "color": "purple"
      }
    ]
  },
  {
    "id": 15,
    "cols": 9,
    "rows": 10,
    "cells": [
      "R...YYGGY",
      "G..Y..PGB",
      ".BGB..G.B",
      ".GGPGYG.P",
      "Y..P..Y.R",
      ".BPR.YRRP",
      ".PBYG.R.P",
      "BY.RP..R.",
      "GP.PBBYB.",
      "GRB..PP.Y"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "green"
      },
      {
        "side": "top",
        "index": 6,
        "color": "purple"
      },
      {
        "side": "bottom",
        "index": 4,
        "color": "red"
      },
      {
        "side": "left",
        "index": 4,
        "color": "yellow"
      },
      {
        "side": "right",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 7,
        "color": "red"
      }
    ]
  },
  {
    "id": 16,
    "cols": 9,
    "rows": 10,
    "cells": [
      "#PG.GP..#",
      "OGYGBRPPP",
      "B.BYRRB..",
      "OYYOPR...",
      "BP..GORO.",
      ".G.G..GP.",
      "..B......",
      ".PRP..GB.",
      "Y..GYG.OG",
      "#R.OOGB.#"
    ],
    "gates": [
      {
        "side": "top",
        "index": 4,
        "color": "orange"
      },
      {
        "side": "bottom",
        "index": 4,
        "color": "purple"
      },
      {
        "side": "left",
        "index": 3,
        "color": "red"
      },
      {
        "side": "left",
        "index": 6,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 3,
        "color": "green"
      },
      {
        "side": "right",
        "index": 6,
        "color": "yellow"
      }
    ]
  },
  {
    "id": 17,
    "cols": 9,
    "rows": 11,
    "cells": [
      "O..OPB.O.",
      ".G.OYG..R",
      "P..O.PORP",
      "R.G.P..BY",
      "RO.YYYBP.",
      "BYPYP..P.",
      "R...P.Y.R",
      ".RO..PRR.",
      "OOYBRYYP.",
      "OGP..ROB.",
      ".BGRGOPP."
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "red"
      },
      {
        "side": "top",
        "index": 6,
        "color": "blue"
      },
      {
        "side": "bottom",
        "index": 2,
        "color": "orange"
      },
      {
        "side": "bottom",
        "index": 6,
        "color": "green"
      },
      {
        "side": "left",
        "index": 5,
        "color": "yellow"
      },
      {
        "side": "right",
        "index": 5,
        "color": "purple"
      },
      {
        "side": "right",
        "index": 9,
        "color": "red"
      }
    ]
  },
  {
    "id": 18,
    "cols": 9,
    "rows": 11,
    "cells": [
      "GBPBG.B.O",
      "BXO.O..X.",
      ".GG..G.YY",
      ".OB.OOGP.",
      "G.P###YRY",
      ".GR###BRB",
      "RB.###BY.",
      "BGRGGB..R",
      "GRY.P.PBO",
      ".XY.P.GXG",
      "...BG.B.."
    ],
    "gates": [
      {
        "side": "top",
        "index": 4,
        "color": "purple"
      },
      {
        "side": "bottom",
        "index": 4,
        "color": "yellow"
      },
      {
        "side": "left",
        "index": 3,
        "color": "green"
      },
      {
        "side": "left",
        "index": 7,
        "color": "orange"
      },
      {
        "side": "right",
        "index": 3,
        "color": "blue"
      },
      {
        "side": "right",
        "index": 7,
        "color": "red"
      }
    ]
  },
  {
    "id": 19,
    "cols": 9,
    "rows": 12,
    "cells": [
      "..BPO..BO",
      "..O.O.P.P",
      "BR.OR.RYO",
      ".O..GPY.R",
      ".OBR.B.PB",
      ".RYBBYGBO",
      "GPBGGRGR.",
      "PRB.R.O.G",
      "BYROGOO..",
      "G.R..R.OY",
      "P...YPORG",
      "RB.YR...P"
    ],
    "gates": [
      {
        "side": "top",
        "index": 3,
        "color": "green"
      },
      {
        "side": "top",
        "index": 5,
        "color": "red"
      },
      {
        "side": "bottom",
        "index": 1,
        "color": "blue"
      },
      {
        "side": "bottom",
        "index": 7,
        "color": "orange"
      },
      {
        "side": "left",
        "index": 4,
        "color": "purple"
      },
      {
        "side": "left",
        "index": 8,
        "color": "yellow"
      },
      {
        "side": "right",
        "index": 6,
        "color": "green"
      }
    ]
  },
  {
    "id": 20,
    "cols": 10,
    "rows": 12,
    "cells": [
      "#PYBRYBG.#",
      ".R.RPR..GR",
      "ROPYBO.R.B",
      "..BYB..R.B",
      "ROYGRYPO.G",
      ".RBBXX.GRG",
      "RRGOXXRORY",
      "...OPY..P.",
      ".POBR..OPP",
      "BOOBYGB.PP",
      ".R.PR..P.O",
      "#R.RRY...#"
    ],
    "gates": [
      {
        "side": "top",
        "index": 2,
        "color": "red"
      },
      {
        "side": "top",
        "index": 7,
        "color": "blue"
      },
      {
        "side": "bottom",
        "index": 2,
        "color": "green"
      },
      {
        "side": "bottom",
        "index": 7,
        "color": "yellow"
      },
      {
        "side": "left",
        "index": 4,
        "color": "purple"
      },
      {
        "side": "left",
        "index": 8,
        "color": "orange"
      },
      {
        "side": "right",
        "index": 4,
        "color": "orange"
      },
      {
        "side": "right",
        "index": 8,
        "color": "purple"
      }
    ]
  }
];
