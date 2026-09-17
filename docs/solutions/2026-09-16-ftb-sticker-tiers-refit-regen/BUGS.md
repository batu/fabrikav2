# Batu's device review, build 2415c7f1ae (2026-09-16 evening)
1. treehouse (ad_campaigns_ad_treehouse_village_bird_24d4): restoration residue
2. L49 bakers enclosure 3e39: bird above the gate near the grains not playable
3. L50 scribes workyard 5094: one bird picks up 3 birds (parchment bird); blue bird near the top shelf not playable
4. L51 kelp gallery c7fa: a bird to the right is fading; Batu: remove the hitbox and paste the clean plate over it
5. L52 captains cabin 3b68: compass cut on pickup, owl cut, two birds collected together (cleanup rects)
6. L53 galley 6b76: barrel bird right of the cleaver + book-reading bird top-left not playable = the two judge-dropped birds (dog_00, dog_28); restored in fix2
7. L54 castle a6ff: green flash between a raven's legs (keying gap); Batu: disable ads in the next build
8. L50 (again, on build 52fb01c5e0): blue bird still missing = VLM never detected it -> added by hand (dog_added_01 at 2210,620, intake_add_bird.py); two-bird pickup = export dog 9 was a 490x571 scene-chunk sticker -> regenerated with a capped crop (157x158)
9. Stacked hitboxes (scan, dist<1.2r): L52 captains cabin owl (dog_11 removed), L91 seaside pier (dog_04 removed), L43 hawaii 91px apart left alone
10. Green key gaps: 44 sprites across 104 levels had green patches (>=12 px); punched transparent
STATUS pass 2 build: fixes 1-10 applied on the exports; verified on renders: 49 (12 birds, tight cleanups), 50 (21 birds incl. blue, tight), 52 (owl single hitbox). Canonical sessions NOT synced with the hand edits (owed).
11. L55/56 clockwork e6bf: cogs cut on pickup of the bird near the robot elephant trunk; faded bird at the bottom of the spool to be removed
12. L57 tidal pool 5dd7: sand castle cut in half -> Batu: remove the level
13. L58 greenhouse 73c9: Batu: remove the level
CORRECTION: level N = ids60 line (N-44). 56 = clockwork (Batu right), 57 = coral bommie garden 86ae (remove), 58 = tidal pool 5dd7 (remove), 59 = greenhouse 73c9 (KEEP, was wrongly removed in pass 3), 61 = alsace wine village 1d5c (remove, bird on top)
14. L61 alsace 1d5c: Batu: remove (bird on top)
15. L63 covered arcade 95e5: ghost residue on most birds (plate drift) -> removed
16. L62 (pass-3 numbering) museum hall 3368: mutant bird in the aquarium left of the ladder (dog 1, the bird inside the tank) -> removed + plate patch; dog 3 was removed by mistake first and restored from the session paint
17. L64 (pass-3) reading room 0feb: map with two birds -> right bird's cleanup covers the whole map, left none; left-table big-book bird picks up the whole book; little mutant bird by the open book on a right table has no hitbox (add)
18. L65 (pass-3) greece_olive_grove_press_bird_dcce: two birds above the well pick up both; wheelbarrow bird leaves residue
19. L68 (pass-3) indian_craft_bazaars_puppet_workshop_bird_08b8: two birds holding a string -> one pickup (merge)
20. L70 (pass-3) japan_festival_grounds_bird_12fb: bird on pillows in front of the drum should clean up all the added pillows
21. L71 (pass-3) mexico_dia_de_muertos_plaza_bird_66a9: one bird picks up the whole table and masks; many birds pick debris -> every bird regenerated with capped crops (MAX_CROP_R=3.2), refit, merged
22. L72 (pass-3) mexico_guanajuato_rainbow_alley_bird_1872: colorful carpet bird picks up the carpet
23. L73 (pass-3) mexico_yucatan_cenote_ruins_bird_9fc3: level renders full white
24. L74 (pass-3) municipal_service_yards_firehouse_court_bird_1d4e: raven very small near the middle; two birds mid-left-top pick up two sprites; toolbox on the bottom-right table gets cut
25. L75 (pass-3) nordic_cold_icelandic_geothermal_town_bird_09ae: bird in the red house missing
FINDING: canonical export writes color.webp at native 2688 while bg_00.webp is 2560 -> unified all levels to 2560 (shipped-44 convention)
26. L76 (pass-3) nordic_cold_sami_aurora_camp_bird_589b: bottom-left birds pick up multiple birds
27. L77 (pass-3) pirate_shipwreck_island_jungle_cave_shore_bird_1c98: cave-entrance bird's dust cloud cut in half; chef bird's hat cut in half
28. L78 (pass-3) prehistoric_dig_enclosures_fossil_pit_bird_f78c: bird in the rolling basket next to the glass cabinet -> delete
29. L79 (pass-3) railway_roundhouse_luggage_island_depot_bird_1480: white bird on the boat with two birds picks up its larger friend
30. L80 (pass-3) railway_roundhouse_sleepy_mountain_rail_stop_bird_e325: yellow bird next to a roller with a crate cuts the crate in half; blue bird on a stool cuts the stool in half
31. L84 (pass-3) turkey_bodrum_marina_sunset_bird_0e4f chocolate factory: some birds on the left carry long track/table debris
32. L85 (pass-3) turkey_grand_bazaar_corridor_bird_2dd8: boat removal cuts tails; Batu: do not restore any area outside a bird's own sprite -> intake_restore_sprites.py (sprite-alpha restoration)
33. L86 turkey_grand_bazaar_corridor_bird_2dd8: two birds on top = one tap; near the sweets one tap picks two; one bird picks a group + table
34. L87 uk_london_high_street_bird_06d0: many non-connected items fly -> all birds regenerated with capped crops
35. L88 uk_oxford_college_quad_bird_0a66: remove
36. L91 underground_crystal_grotto_bird_43ad: umbrella-cage bird and green-machine bird pick up too much; the paint added whole stairs on the right; missing hitboxes -> REMOVE + process-failure diagnosis
37. L92 underground_metro_concourse_bird_94a1: numbers painted in the scene -> REMOVE
38. L94 underground_wine_cellars_bird_2c71: two faded birds on the columns (left and right) -> patch out
39. L95 walled_gardens_cloister_herbarium_bird_1c66: residue and big pickups, salvageable
40. L96: cushion cut off bottom right (level TBD by content)
MAPPING: 91=crystal grotto (removed), 92=thermal bathhouse (painted digits, removed), 94=cloister herbarium, 95=kitchen garden 3118, 96=riad courtyard
41. L100 italy_tuscan_hill_village_bird_a61f: every pickup takes the building -> removed; root cause: scene-chunk stickers pass refit (pop~0) and judge; no chunk gate. Detector added (alpha fill > 0.8 of bbox and bbox > 2.2r)
42. ORDER: move sequence levels 3, 4, 5 to position 67 (Batu)
25b. L75: red-house bird added at 1037,1046
MAPPING: 78 = luggage depot 1480 (basket bird 2 removed)
MAPPING: 79 = floating market 8d44 (white bird 11 / friend 12 tightened); 80 = hydroponics bay (crate/stool cuts resolved by the sprite-footprint restoration)
RESOLVED BY CONSTRUCTION (sprite-footprint restoration, all 60): 52 compass, 56 cogs, 65 wheelbarrow residue, 72 carpet, 74 toolbox, 80 crate/stool, 96 cushion, 1 treehouse residue
BATCH: 197 oversized stickers on 41 levels regenerating with capped crops (regen_chunks.sh), covers 76 bottom-left, 95 big pickups, 84/87 debris

43. L36 japan night harbor: bird picks up the whole boat -> sprite-footprint restoration applied to all 44 shipped levels
44. L37-40 (the four 4096 levels, old 40-43): plates never matched the paint -> stretch, stay-behind birds, wrong reveals -> REMOVED (Batu)
45. Green sweep damage on the phone build: plumage punched on green birds -> restored pre-sweep bytes, strict key-green rule
