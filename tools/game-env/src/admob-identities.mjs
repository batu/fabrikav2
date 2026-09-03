import fs from 'node:fs';

function readPublicAdMobConfig(game) {
  const configUrl = new URL(`../../../games/${game}/config/admob.public.json`, import.meta.url);
  const config = JSON.parse(fs.readFileSync(configUrl, 'utf8'));
  return Object.freeze({
    appId: config.appId,
    adUnits: Object.freeze({
      banner: config.adUnits.banner,
      interstitial: config.adUnits.interstitial,
      rewarded: config.adUnits.rewarded,
    }),
  });
}

export const FIND_THE_DOG_ADMOB_IDENTITY = readPublicAdMobConfig('find_the_dog');
export const FIND_THE_BIRD_ADMOB_IDENTITY = readPublicAdMobConfig('find_the_bird');
