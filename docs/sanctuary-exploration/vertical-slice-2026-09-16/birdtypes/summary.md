# Bird sprite classification summary

Total birds: 182  |  Classified: 175  |  Failed (unresolved after retries): 7

Total agy calls made: 175


## Type frequency

| type | count | share |
|---|---|---|
| sparrow | 47 | 26.9% |
| robin | 20 | 11.4% |
| wren | 13 | 7.4% |
| bluebird | 12 | 6.9% |
| finch | 9 | 5.1% |
| blue tit | 6 | 3.4% |
| generic-songbird | 6 | 3.4% |
| wagtail | 5 | 2.9% |
| goldfinch | 5 | 2.9% |
| cardinal | 5 | 2.9% |
| chickadee | 5 | 2.9% |
| owl | 4 | 2.3% |
| nuthatch | 4 | 2.3% |
| canary | 3 | 1.7% |
| unknown-songbird | 3 | 1.7% |
| duck | 3 | 1.7% |
| swallow | 2 | 1.1% |
| jay | 2 | 1.1% |
| quail | 2 | 1.1% |
| blue jay | 2 | 1.1% |
| kingfisher | 2 | 1.1% |
| starling | 1 | 0.6% |
| blackbird | 1 | 0.6% |
| warbler | 1 | 0.6% |
| roadrunner | 1 | 0.6% |
| parrot | 1 | 0.6% |
| magpie | 1 | 0.6% |
| tanager | 1 | 0.6% |
| osprey | 1 | 0.6% |
| sandpiper | 1 | 0.6% |
| heron | 1 | 0.6% |
| plover | 1 | 0.6% |
| titmouse | 1 | 0.6% |
| woodpecker | 1 | 0.6% |
| bullfinch | 1 | 0.6% |
| tit | 1 | 0.6% |

## Color frequency (dominant+secondary combined)

| color | count |
|---|---|
| brown | 95 |
| orange | 42 |
| white | 36 |
| blue | 30 |
| tan | 27 |
| gray | 25 |
| yellow | 24 |
| beige | 22 |
| black | 18 |
| green | 10 |
| grey | 8 |
| red | 8 |
| cream | 2 |
| olive | 1 |
| blue-gray | 1 |
| pink | 1 |

## Pose frequency

| pose | count |
|---|---|
| standing | 138 |
| perched | 35 |
| flying | 1 |
| swimming | 1 |

## Low confidence (<0.6): 2 of 175


## Failures: 7

- alpine_meadow_cheese_farm_courtyard_bird_aba2 / dog_13 — timeout
- alpine_meadow_cheese_farm_courtyard_bird_aba2 / dog_14 — timeout
- alpine_meadow_goat_pasture_terraces_bird_6dff / dog_15 — timeout
- alpine_meadow_goat_pasture_terraces_bird_6dff / dog_20 — timeout
- american_southwest_sw_canyon_river_camp_bird_6221 / dog_12 — timeout
- cozy_interiors_cozy_potting_shed_garden_bird_bd9a / dog_01 — timeout
- cozy_interiors_cozy_potting_shed_garden_bird_bd9a / dog_04 — timeout

## Per-level type clustering (top 3 per level)

- alpine_meadow_cheese_farm_courtyard_bird_aba2: sparrow(6), finch(3), robin(2)
- alpine_meadow_goat_pasture_terraces_bird_6dff: robin(3), unknown-songbird(3), wren(2)
- american_southwest_sw_adobe_courtyard_bird_419b: sparrow(8), bluebird(3), roadrunner(1)
- american_southwest_sw_cactus_garden_ranch_bird_19f1: sparrow(3), wren(2), cardinal(1)
- american_southwest_sw_canyon_river_camp_bird_6221: duck(3), wren(3), robin(1)
- american_southwest_sw_desert_trading_post_bird_7396: sparrow(8), bluebird(4), owl(2)
- american_southwest_sw_mesa_campground_bird_563d: sparrow(7), cardinal(2), robin(2)
- cozy_interiors_cozy_attic_workshop_bird_6acc: robin(6), sparrow(5), chickadee(3)
- cozy_interiors_cozy_potting_shed_garden_bird_bd9a: sparrow(3), robin(2), goldfinch(2)
- cozy_interiors_cozy_toymaker_workshop_bird_4e44: sparrow(5), wren(3), bluebird(3)

## Tagging idea

Type distribution is dominated by sparrow/robin/wren/bluebird in every level regardless of biome — type alone won't drive an interesting "collection" grid since >50% of birds land in 4 buckets. The differentiation shows up as a handful of biome-specific outliers per level instead (duck+wren cluster at the river-camp level, a roadrunner and extra owls at the desert levels, no waterfowl at all in the cozy-interior levels). A collection feature is likely better served by pairing type with a biome/level-theme tag (derivable from the level id prefix, e.g. `alpine_meadow_`, `american_southwest_`, `cozy_interiors_`) so rare/outlier birds per biome feel like the "collectibles," rather than relying on type frequency alone.
