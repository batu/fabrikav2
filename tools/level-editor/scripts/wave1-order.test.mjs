import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const orderFile = new URL('./wave1_order.txt', import.meta.url);
const treehouseLevel = 'ad_campaigns_ad_treehouse_village_bird_24d4';
const cappadociaLevel = 'turkey_cappadocia_balloon_dawn_bird_b03c';

test('the broken treehouse is deferred and Cappadocia opens the lineup', async () => {
  const levelIds = (await readFile(orderFile, 'utf8'))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.equal(levelIds[0], cappadociaLevel);
  assert.equal(levelIds[41], treehouseLevel);
});