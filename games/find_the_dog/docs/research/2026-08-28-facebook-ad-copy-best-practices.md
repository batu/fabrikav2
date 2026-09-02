# Facebook ad copy best practices for Find the Dog

Assumption: “headline” and “primary text” refer to Meta/Facebook feed-style app ads.

## Findings

- Lead with the main value or hook. Meta recommends keeping copy concise and putting the most important message first because primary text may truncate by placement.
- Treat primary text and headline as a pair: primary text supplies the premise; the headline delivers the shortest benefit or challenge rather than repeating it.
- Write for mobile scanning. Short sentences, concrete verbs, and one idea per variant are safer across Meta’s automatic placements.
- Keep critical copy within Meta’s placement recommendations. Meta’s Ads Guide commonly recommends about 125 characters for primary text and about 27 characters for headlines for feed placements; rendering varies by placement, device, and optimization.
- Build materially different variants, not punctuation swaps. Meta recommends creative diversification and testing; vary the hook (challenge, curiosity, relaxation, progression, collection) while keeping the game claim truthful.
- Let the creative carry detail. Copy should make the gameplay immediately legible—scan a busy scene, spot hidden dogs, tap—without explaining every system.
- Avoid unverifiable superlatives, fake urgency, engagement bait, and claims not supported by the product. Find the Dog currently supports 54 saga levels, hints, lives, progression, and hidden-dog scenes; “free,” “no ads,” or multiplayer claims were not used because the checked repository does not establish them as universal acquisition claims.

## Applied copy constraints

- Primary text target: 125 characters or fewer.
- Headline target: 27 characters or fewer.
- Every variant communicates hidden-object gameplay or a concrete player benefit.
- Variants are usable as a testing matrix rather than five near-duplicates.

## Primary sources

- Meta Ads Guide: https://www.facebook.com/business/ads-guide
- Meta, Facebook Feed placement: https://www.facebook.com/business/ads-guide/update/image/facebook-feed
- Meta, Creative diversification: https://www.facebook.com/business/ads/ad-creative
- Meta Advertising Standards: https://transparency.meta.com/policies/ad-standards/
- Meta Business Help Center, A/B testing: https://www.facebook.com/business/help/1738164643098669

## Audience-angle research

Meta permits audience definition using broad signals such as age, location, and interests, while Lookalike Audiences can find people similar to strong existing players and Custom Audiences can re-engage existing users. Available interest labels vary by account and market, and Advantage+ audience may expand beyond suggestions. Use the groups below as creative hypotheses first, then let install and retention data decide.

Recommended initial creative groups:

1. **Hidden-object and puzzle players** — lead with challenge, observation, and escalating searches.
2. **Mindfulness and relaxation seekers** — lead with calm focus, an unhurried visual break, and satisfying discovery; do not promise treatment for stress or anxiety.
3. **Cognitive-wellness players** — lead with attention, recall, and a playful mental workout; avoid claims that the game improves memory or prevents cognitive decline.
4. **Dog lovers** — lead with cute dogs, personality, and the pleasure of discovering another pup.
5. **Casual progression players** — lead with endless scenes, short sessions, collecting wins, and always having another puzzle available.

For acquisition, test these as distinct creative/copy angles under broad or Advantage+ targeting rather than over-constraining each ad set with narrow interests. Once enough quality events exist, prioritize Lookalike Audiences based on retained or high-value players—not merely installers. Customer-list audiences require the necessary rights, permissions, and lawful basis.

Additional primary sources:

- Meta Audience Network, audience optimization: https://en-gb.facebook.com/audiencenetwork/monetization-tips/optimization/audience
- Meta Customer List Custom Audiences Terms: https://www.facebook.com/legal/terms/customaudience/update

## Product sources checked

- `games/find_the_dog/game.config.ts`
- `games/find_the_dog/design/copy.ts`
- `games/find_the_dog/src/scenes/GameScene.ts`
- `games/find_the_dog/src/ui/HUD.ts`
