export type CanonicalEventFamily = 'progression' | 'design' | 'resource' | 'ad' | 'business' | 'error' | 'performance' | 'firebase_only';

export type CanonicalDashboardPanel = 'retention' | 'level_funnel' | 'difficulty' | 'store' | 'ads' | 'economy' | 'quality';

export type CanonicalInstrumentationStatus = 'runtime' | 'contract' | 'provider_followup';

export interface CanonicalAnalyticsEventDefinition {
  readonly id: string;
  readonly firebaseName: string;
  readonly gameAnalyticsName: string;
  readonly family: CanonicalEventFamily;
  readonly panel: CanonicalDashboardPanel;
  readonly question: string;
  readonly primaryDimensions: readonly string[];
  readonly instrumentationStatus: CanonicalInstrumentationStatus;
  readonly successBoundary: string;
  readonly allowedGameAnalyticsCustomFields?: readonly string[];
  readonly alertWhen?: string;
}

export const canonicalDashboardPanels = ['retention', 'level_funnel', 'difficulty', 'store', 'ads', 'economy', 'quality'] as const satisfies readonly CanonicalDashboardPanel[];

export const panelLabels: Record<CanonicalDashboardPanel, string> = {
  retention: 'Retention',
  level_funnel: 'Level Funnel',
  difficulty: 'Difficulty',
  store: 'Store & IAP',
  ads: 'Ads',
  economy: 'Economy',
  quality: 'Quality',
};

const levelAttributionFields = [
  'level_id',
  'level_name',
  'sequence_slot',
  'display_level_number',
  'intended_level_id',
  'served_level_id',
  'fallback_reason',
  'sequence_version',
  'sequence_source',
  'category',
  'catalog_revision',
  'app_version',
  'platform',
  'cohort_bucket',
] as const;

const economyFields = ['flow_type', 'currency', 'amount', 'item_type', 'item_id', 'product_id', 'no_ads', 'hints', 'coins', 'continue_level', 'level_id'] as const;
const adRevenueFields = ['ad_type', 'placement', 'provider', 'currency', 'precision', 'network_name'] as const;

export const canonicalAnalyticsEvents = [
  {
    id: 'app_open',
    firebaseName: 'app_open',
    gameAnalyticsName: 'app:open',
    family: 'design',
    panel: 'retention',
    question: 'Daily active app opens, split by cohort.',
    primaryDimensions: ['cohort_bucket'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Application boot calls analytics.appOpen().',
    allowedGameAnalyticsCustomFields: ['cohort_bucket'],
  },
  {
    id: 'app_foreground',
    firebaseName: 'app_foreground',
    gameAnalyticsName: 'app:foreground',
    family: 'design',
    panel: 'retention',
    question: 'Return-to-session frequency after backgrounding.',
    primaryDimensions: [],
    instrumentationStatus: 'contract',
    successBoundary: 'App lifecycle foreground transition is observed.',
  },
  {
    id: 'app_background',
    firebaseName: 'app_background',
    gameAnalyticsName: 'app:background',
    family: 'design',
    panel: 'retention',
    question: 'Foreground segment depth before players leave.',
    primaryDimensions: ['levels_played'],
    instrumentationStatus: 'contract',
    successBoundary: 'App lifecycle background transition is observed.',
  },
  {
    id: 'experiment_exposure',
    firebaseName: 'experiment_exposure',
    gameAnalyticsName: 'experiment:exposure',
    family: 'design',
    panel: 'retention',
    question: 'When users actually enter a level-set or UI experiment.',
    primaryDimensions: ['experiment_id', 'bucket'],
    instrumentationStatus: 'contract',
    successBoundary: 'Player becomes eligible for and sees an experiment-controlled surface.',
  },
  {
    id: 'level_start',
    firebaseName: 'level_start',
    gameAnalyticsName: 'Progression start shell_template:<level_id>',
    family: 'progression',
    panel: 'level_funnel',
    question: 'How many attempts start per level, slot, and cohort.',
    primaryDimensions: ['level_id', 'level_name', 'sequence_slot', 'intended_level_id', 'served_level_id'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Level scene starts a playable attempt.',
    allowedGameAnalyticsCustomFields: levelAttributionFields,
  },
  {
    id: 'level_complete',
    firebaseName: 'level_complete',
    gameAnalyticsName: 'Progression complete shell_template:<level_id>',
    family: 'progression',
    panel: 'level_funnel',
    question: 'Completion rate and completion time by level and slot.',
    primaryDimensions: ['level_id', 'sequence_slot'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Final dog found and completion transaction begins.',
    allowedGameAnalyticsCustomFields: [...levelAttributionFields, 'time_seconds', 'hints_used', 'wrong_taps'],
  },
  {
    id: 'level_failed',
    firebaseName: 'level_failed',
    gameAnalyticsName: 'Progression fail shell_template:<level_id>',
    family: 'progression',
    panel: 'level_funnel',
    question: 'Hard fail rate from running out of lives.',
    primaryDimensions: ['level_id', 'sequence_slot', 'dogs_found'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Lives reach zero and the failed attempt is committed.',
    allowedGameAnalyticsCustomFields: [...levelAttributionFields, 'dogs_found'],
    alertWhen: 'Fail rate rises above the expected onboarding curve for a level.',
  },
  {
    id: 'level_abandoned',
    firebaseName: 'level_abandoned',
    gameAnalyticsName: 'level:abandoned',
    family: 'design',
    panel: 'level_funnel',
    question: 'Soft churn inside an active level.',
    primaryDimensions: ['level_id', 'sequence_slot', 'dogs_found'],
    instrumentationStatus: 'contract',
    successBoundary: 'Player leaves an active level without completion or hard fail.',
  },
  {
    id: 'dog_found',
    firebaseName: 'dog_found',
    gameAnalyticsName: 'dog:found',
    family: 'design',
    panel: 'difficulty',
    question: 'Per-dog discovery cadence inside a level.',
    primaryDimensions: ['level_id', 'dog_index'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Correct dog tap is accepted by gameplay.',
    allowedGameAnalyticsCustomFields: [...levelAttributionFields, 'dog_index', 'time_since_start'],
  },
  {
    id: 'time_to_first_find',
    firebaseName: 'time_to_first_find',
    gameAnalyticsName: 'level:first_find',
    family: 'design',
    panel: 'difficulty',
    question: 'Whether the first success arrives quickly enough.',
    primaryDimensions: ['level_id', 'sequence_slot', 'bucket'],
    instrumentationStatus: 'contract',
    successBoundary: 'First dog found in a level attempt.',
    alertWhen: 'Median first find drifts above 30 seconds on early levels.',
  },
  {
    id: 'wrong_tap',
    firebaseName: 'wrong_tap',
    gameAnalyticsName: 'wrong_tap',
    family: 'design',
    panel: 'difficulty',
    question: 'Miss density and heatmap candidates by level.',
    primaryDimensions: ['level_id', 'sequence_slot', 'coordinate_bucket'],
    instrumentationStatus: 'contract',
    successBoundary: 'Wrong tap penalty is applied.',
  },
  {
    id: 'hint_used',
    firebaseName: 'hint_used',
    gameAnalyticsName: 'hint:used plus resource sink hints',
    family: 'resource',
    panel: 'difficulty',
    question: 'Where players need paid/free help.',
    primaryDimensions: ['level_id', 'sequence_slot', 'dogs_found', 'finds_remaining'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Hint spend succeeds in local game state.',
    allowedGameAnalyticsCustomFields: [...levelAttributionFields, 'dogs_found'],
  },
  {
    id: 'store_opened',
    firebaseName: 'store_opened',
    gameAnalyticsName: 'store:open',
    family: 'design',
    panel: 'store',
    question: 'Where store intent starts.',
    primaryDimensions: ['entry_point', 'section'],
    instrumentationStatus: 'contract',
    successBoundary: 'Store surface becomes visible.',
  },
  {
    id: 'paywall_impression',
    firebaseName: 'paywall_impression',
    gameAnalyticsName: 'store:impression',
    family: 'design',
    panel: 'store',
    question: 'How often purchasable products are visible.',
    primaryDimensions: ['product_count'],
    instrumentationStatus: 'contract',
    successBoundary: 'Purchasable products are rendered.',
  },
  {
    id: 'product_tapped',
    firebaseName: 'product_tapped',
    gameAnalyticsName: 'store:product_tap',
    family: 'design',
    panel: 'store',
    question: 'SKU-level buying intent.',
    primaryDimensions: ['product_id'],
    instrumentationStatus: 'contract',
    successBoundary: 'Player taps a product before native sheet opens.',
  },
  {
    id: 'purchase_initiated',
    firebaseName: 'purchase_initiated',
    gameAnalyticsName: 'purchase:initiated',
    family: 'design',
    panel: 'store',
    question: 'Native purchase sheet entry.',
    primaryDimensions: ['product_id'],
    instrumentationStatus: 'contract',
    successBoundary: 'Native purchase flow is requested.',
  },
  {
    id: 'purchase_cancelled',
    firebaseName: 'purchase_cancelled',
    gameAnalyticsName: 'purchase:cancelled',
    family: 'design',
    panel: 'store',
    question: 'User cancellation after native purchase sheet.',
    primaryDimensions: ['product_id'],
    instrumentationStatus: 'contract',
    successBoundary: 'Store SDK returns user-cancelled purchase result.',
  },
  {
    id: 'purchase_failed',
    firebaseName: 'purchase_failed',
    gameAnalyticsName: 'purchase:failed',
    family: 'design',
    panel: 'store',
    question: 'Store-side errors separate from user cancellations.',
    primaryDimensions: ['product_id', 'reason'],
    instrumentationStatus: 'contract',
    successBoundary: 'Store SDK returns non-cancel purchase failure.',
    alertWhen: 'Any product shows repeated non-cancel failures.',
  },
  {
    id: 'purchase_fulfilled',
    firebaseName: 'purchase_fulfilled',
    gameAnalyticsName: 'purchase:fulfilled plus resource/business events',
    family: 'business',
    panel: 'store',
    question: 'Delivered purchases and recognized real-money revenue.',
    primaryDimensions: ['product_id', 'currency', 'no_ads', 'continue_level'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Purchase validation and local wallet/entitlement grant succeed.',
    allowedGameAnalyticsCustomFields: economyFields,
  },
  {
    id: 'purchase_unfulfilled',
    firebaseName: 'purchase_unfulfilled',
    gameAnalyticsName: 'purchase:unfulfilled',
    family: 'design',
    panel: 'quality',
    question: 'Paid but not delivered incidents.',
    primaryDimensions: ['product_id', 'outcome'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Store reported purchased, but app fulfillment did not deliver value.',
    allowedGameAnalyticsCustomFields: ['product_id', 'outcome'],
    alertWhen: 'Any non-zero count deserves investigation.',
  },
  {
    id: 'restore_initiated',
    firebaseName: 'restore_initiated',
    gameAnalyticsName: 'restore:initiated',
    family: 'design',
    panel: 'store',
    question: 'Restore demand.',
    primaryDimensions: [],
    instrumentationStatus: 'contract',
    successBoundary: 'Player starts restore purchases.',
  },
  {
    id: 'restore_completed',
    firebaseName: 'restore_completed',
    gameAnalyticsName: 'restore:completed',
    family: 'design',
    panel: 'store',
    question: 'Restore success and whether entitlement changed.',
    primaryDimensions: ['restored_something'],
    instrumentationStatus: 'contract',
    successBoundary: 'Restore finishes successfully.',
  },
  {
    id: 'restore_failed',
    firebaseName: 'restore_failed',
    gameAnalyticsName: 'restore:failed',
    family: 'design',
    panel: 'quality',
    question: 'Restore failures that create support risk.',
    primaryDimensions: [],
    instrumentationStatus: 'contract',
    successBoundary: 'Restore returns an error.',
    alertWhen: 'Any spike after an IAP release.',
  },
  {
    id: 'offer_shown',
    firebaseName: 'offer_shown',
    gameAnalyticsName: 'offer:shown',
    family: 'design',
    panel: 'store',
    question: 'Hint booster and continue offer exposure.',
    primaryDimensions: ['offer_type', 'placement'],
    instrumentationStatus: 'contract',
    successBoundary: 'Offer UI becomes visible.',
  },
  {
    id: 'offer_outcome',
    firebaseName: 'offer_outcome',
    gameAnalyticsName: 'offer:outcome',
    family: 'design',
    panel: 'store',
    question: 'Offer acceptance or decline.',
    primaryDimensions: ['offer_type', 'outcome'],
    instrumentationStatus: 'contract',
    successBoundary: 'Player accepts or declines an offer.',
  },
  {
    id: 'ad_requested',
    firebaseName: 'ad_requested',
    gameAnalyticsName: 'Firebase only',
    family: 'firebase_only',
    panel: 'ads',
    question: 'Ad provider request volume.',
    primaryDimensions: ['ad_type', 'placement'],
    instrumentationStatus: 'contract',
    successBoundary: 'Ad request is sent to the provider.',
  },
  {
    id: 'ad_loaded',
    firebaseName: 'ad_loaded',
    gameAnalyticsName: 'Firebase only',
    family: 'firebase_only',
    panel: 'ads',
    question: 'Fill against request volume.',
    primaryDimensions: ['ad_type', 'placement'],
    instrumentationStatus: 'contract',
    successBoundary: 'Ad provider reports loaded creative.',
  },
  {
    id: 'ad_load_failed',
    firebaseName: 'ad_load_failed',
    gameAnalyticsName: 'Firebase only',
    family: 'firebase_only',
    panel: 'ads',
    question: 'No-fill and load error reasons.',
    primaryDimensions: ['ad_type', 'placement', 'reason'],
    instrumentationStatus: 'contract',
    successBoundary: 'Ad provider load request fails.',
    alertWhen: 'No-fill spikes or errors replace loaded events.',
  },
  {
    id: 'ad_shown',
    firebaseName: 'ad_shown',
    gameAnalyticsName: 'Ad show',
    family: 'ad',
    panel: 'ads',
    question: 'Actual ad impressions shown.',
    primaryDimensions: ['ad_type', 'placement'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Ad service reports shown.',
  },
  {
    id: 'ad_show_failed',
    firebaseName: 'ad_show_failed',
    gameAnalyticsName: 'Ad failed_show',
    family: 'ad',
    panel: 'ads',
    question: 'Loaded ads that could not show.',
    primaryDimensions: ['ad_type', 'placement', 'reason'],
    instrumentationStatus: 'contract',
    successBoundary: 'Show is requested after load, but provider reports failure.',
    alertWhen: 'Repeated show failures on rewarded placements.',
  },
  {
    id: 'rewarded_ad_granted',
    firebaseName: 'rewarded_ad_granted',
    gameAnalyticsName: 'Ad reward_received',
    family: 'ad',
    panel: 'ads',
    question: 'Rewarded watches that granted value.',
    primaryDimensions: ['placement'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Rewarded ad completes and local reward/resume succeeds.',
  },
  {
    id: 'ad_revenue_paid',
    firebaseName: 'ad_revenue_paid',
    gameAnalyticsName: 'ad:revenue',
    family: 'business',
    panel: 'ads',
    question: 'Observed impression-level ad revenue reported by the mediation SDK.',
    primaryDimensions: ['ad_type', 'placement', 'provider', 'precision'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Ad provider reports a paid revenue callback after an impression.',
    allowedGameAnalyticsCustomFields: adRevenueFields,
  },
  {
    id: 'rewarded_dismissed',
    firebaseName: 'rewarded_dismissed',
    gameAnalyticsName: 'Firebase only',
    family: 'firebase_only',
    panel: 'ads',
    question: 'Rewarded videos dismissed without reward.',
    primaryDimensions: ['placement'],
    instrumentationStatus: 'contract',
    successBoundary: 'Rewarded ad closes without reward grant.',
  },
  {
    id: 'resource_changed',
    firebaseName: 'resource_changed',
    gameAnalyticsName: 'Resource source/sink',
    family: 'resource',
    panel: 'economy',
    question: 'Coin and hint economy balance.',
    primaryDimensions: ['flow_type', 'currency', 'amount', 'item_type', 'item_id'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Local wallet/resource mutation succeeds.',
    allowedGameAnalyticsCustomFields: economyFields,
  },
  {
    id: 'reward_milestone',
    firebaseName: 'reward_milestone',
    gameAnalyticsName: 'reward:milestone',
    family: 'design',
    panel: 'economy',
    question: 'Retention reward cadence and payout.',
    primaryDimensions: ['goal', 'hints_granted'],
    instrumentationStatus: 'contract',
    successBoundary: 'Retention reward milestone grants value.',
  },
  {
    id: 'settings_changed',
    firebaseName: 'settings_changed',
    gameAnalyticsName: 'settings:<setting_name>',
    family: 'design',
    panel: 'retention',
    question: 'Preference toggles that may correlate with churn.',
    primaryDimensions: ['setting_name', 'new_value'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Player setting mutation is accepted.',
    allowedGameAnalyticsCustomFields: ['setting_name', 'new_value'],
  },
  {
    id: 'rate_prompt',
    firebaseName: 'rate_prompt',
    gameAnalyticsName: 'rate_prompt:<action>',
    family: 'design',
    panel: 'retention',
    question: 'Review prompt exposure and response.',
    primaryDimensions: ['action'],
    instrumentationStatus: 'contract',
    successBoundary: 'Review prompt is shown or acted on.',
  },
  {
    id: 'error',
    // `error` is a GA4 *reserved* event name — the native Firebase SDK silently
    // drops reserved names at logEvent. Emit as `client_error` so the event
    // survives on device. Internal id stays `error`. See analytics-reserved-names.spec.
    firebaseName: 'client_error',
    gameAnalyticsName: 'Error <severity>',
    family: 'error',
    panel: 'quality',
    question: 'Handled operational failures by domain.',
    primaryDimensions: ['domain', 'severity'],
    instrumentationStatus: 'contract',
    successBoundary: 'Handled operational failure is observed.',
    alertWhen: 'Any error domain trends upward release-over-release.',
  },
  {
    id: 'performance_sample',
    firebaseName: 'performance_sample',
    gameAnalyticsName: 'performance:sample',
    family: 'performance',
    panel: 'quality',
    question: 'Frame, load, and interaction latency buckets that may block level or monetization decisions.',
    primaryDimensions: ['surface', 'bucket', 'app_version', 'platform'],
    instrumentationStatus: 'contract',
    successBoundary: 'A sampled performance bucket is recorded after a menu, level, ad, or purchase surface renders.',
    allowedGameAnalyticsCustomFields: ['surface', 'bucket', 'app_version', 'platform'],
    alertWhen: 'Any release moves key surfaces into slow or jank-heavy buckets.',
  },
  {
    id: 'achievement_progress',
    firebaseName: 'achievement_progress',
    gameAnalyticsName: 'achievement:progress',
    family: 'design',
    panel: 'retention',
    question: 'How far players advance toward each achievement threshold.',
    primaryDimensions: ['achievement_id', 'category'],
    instrumentationStatus: 'runtime',
    successBoundary: 'GameState folds an accepted achievement fact that advances progress and drains its outbox.',
    allowedGameAnalyticsCustomFields: ['achievement_id', 'occurrence_id', 'event_id', 'category', 'progress', 'threshold'],
  },
  {
    id: 'achievement_unlocked',
    firebaseName: 'achievement_unlocked',
    gameAnalyticsName: 'achievement:unlocked',
    family: 'design',
    panel: 'retention',
    question: 'Which achievements players unlock and how often.',
    primaryDimensions: ['achievement_id', 'category'],
    instrumentationStatus: 'runtime',
    successBoundary: 'GameState commits an achievement unlock and drains its outbox.',
    allowedGameAnalyticsCustomFields: ['achievement_id', 'occurrence_id', 'event_id', 'category', 'threshold'],
  },
  {
    id: 'achievement_reward_granted',
    firebaseName: 'achievement_reward_granted',
    gameAnalyticsName: 'achievement:reward:granted',
    family: 'design',
    panel: 'economy',
    question: 'Applied achievement reward coins/hints by achievement.',
    primaryDimensions: ['achievement_id'],
    instrumentationStatus: 'runtime',
    successBoundary: 'GameState finalizes an achievement settlement and drains its outbox.',
    allowedGameAnalyticsCustomFields: ['achievement_id', 'occurrence_id', 'event_id', 'category', 'reward_coins', 'reward_hints'],
  },
  {
    id: 'achievement_reconciliation_anomaly',
    firebaseName: 'achievement_reconciliation_anomaly',
    gameAnalyticsName: 'achievement:reconciliation:anomaly',
    family: 'design',
    panel: 'quality',
    question: 'Wallet components that failed clean write-ahead settlement recovery.',
    primaryDimensions: ['wallet_component'],
    instrumentationStatus: 'runtime',
    successBoundary: 'Load-time settlement recovery finds a wallet component matching neither snapshot.',
    allowedGameAnalyticsCustomFields: ['achievement_id', 'occurrence_id', 'event_id', 'category', 'wallet_component'],
  },
  {
    id: 'achievement_viewed',
    firebaseName: 'achievement_viewed',
    gameAnalyticsName: 'achievement:viewed',
    family: 'design',
    panel: 'retention',
    question: 'Which achievement cards players view (emitted by the ACH-2 UI card).',
    primaryDimensions: ['achievement_id'],
    instrumentationStatus: 'contract',
    successBoundary: 'The achievement UI card (ACH-2) surfaces a single achievement.',
    allowedGameAnalyticsCustomFields: ['achievement_id', 'occurrence_id', 'event_id', 'category'],
  },
  {
    id: 'achievement_page_viewed',
    firebaseName: 'achievement_page_viewed',
    gameAnalyticsName: 'achievement:page:viewed',
    family: 'design',
    panel: 'retention',
    question: 'How often players open the achievements page (emitted by the ACH-2 UI card).',
    primaryDimensions: [],
    instrumentationStatus: 'contract',
    successBoundary: 'The achievement UI card (ACH-2) opens the achievements page.',
    allowedGameAnalyticsCustomFields: ['event_id'],
  },
] as const satisfies readonly CanonicalAnalyticsEventDefinition[];

export type CanonicalAnalyticsEventId = (typeof canonicalAnalyticsEvents)[number]['id'];

export const canonicalEventIds = canonicalAnalyticsEvents.map((event) => event.id);

const firebaseEventNamesById = new Map<string, string>(canonicalAnalyticsEvents.map((event) => [event.id, event.firebaseName]));

/**
 * Resolve the GA4/Firebase wire name for a canonical event id. Emitting through
 * this — rather than passing a hand-written literal to logEvent — keeps the wire
 * name governed by the registry, so a reserved-name rename (e.g. error →
 * client_error) reaches the device without every call site having to remember it.
 */
export function firebaseEventName(id: CanonicalAnalyticsEventId): string {
  const name = firebaseEventNamesById.get(id);
  if (name === undefined) throw new Error(`Unknown canonical analytics event id: ${id}`);
  return name;
}

export const forbiddenAnalyticsIdentifierKeys = [
  'purchase_id',
  'purchaseid',
  'transaction_id',
  'transactionid',
  'provider_transaction_id',
  'providertransactionid',
  'receipt',
  'purchase_token',
  'purchasetoken',
  'event_occurrence_id',
  'eventoccurrenceid',
  'dedupe_key',
  'dedupekey',
  'anonymous_install_id',
  'anonymousinstallid',
  'install_id',
  'installid',
  'ad_impression_id',
  'adimpressionid',
  'ad_account_id',
  'adaccountid',
  'user_id',
  'userid',
  'device_id',
  'deviceid',
  'idfa',
  'advertising_id',
  'advertisingid',
  'email',
  'admin_url',
  'adminurl',
] as const;

const canonicalAnalyticsEventDefinitions: readonly CanonicalAnalyticsEventDefinition[] = canonicalAnalyticsEvents;

export const gameAnalyticsAllowedCustomFieldKeys = uniqueStrings(canonicalAnalyticsEventDefinitions.flatMap((event) => [...(event.allowedGameAnalyticsCustomFields ?? [])]));

const gameAnalyticsAllowedCustomFieldKeySet = new Set(gameAnalyticsAllowedCustomFieldKeys.map(normalizeAnalyticsFieldKey));
const gameAnalyticsAllowedCustomFieldKeySetsByEventId = new Map(
  canonicalAnalyticsEventDefinitions.map((event) => [
    event.id,
    new Set((event.allowedGameAnalyticsCustomFields ?? []).map(normalizeAnalyticsFieldKey)),
  ]),
);
const forbiddenAnalyticsIdentifierKeySet = new Set(forbiddenAnalyticsIdentifierKeys.map(normalizeAnalyticsFieldKey));

// Must stay a superset of every event's `primaryDimensions` — those are the
// dimensions the contract declares as displayable, and both the live-feed and
// manual-import paths reject any key not on this list (silently dropping it live,
// throwing on import). The canonical-events test asserts the superset invariant so
// a new primaryDimension can't drift out of this allowlist unnoticed.
export const dashboardImportDimensionKeys = [
  'achievement_id',
  'action',
  'ad_type',
  'amount',
  'app_version',
  'bucket',
  'category',
  'catalog_revision',
  'cohort_bucket',
  'continue_level',
  'coordinate_bucket',
  'currency',
  'display_level_number',
  'dogs_found',
  'domain',
  'dog_index',
  'entry_point',
  'experiment_id',
  'fallback_reason',
  'finds_remaining',
  'flow_type',
  'goal',
  'hints_granted',
  'intended_level_id',
  'item_id',
  'item_type',
  'level_id',
  'level_name',
  'levels_played',
  'new_value',
  'no_ads',
  'offer_type',
  'outcome',
  'placement',
  'platform',
  'precision',
  'product_count',
  'product_id',
  'provider',
  'reason',
  'restored_something',
  'section',
  'sequence_slot',
  'sequence_source',
  'sequence_version',
  'served_level_id',
  'setting_name',
  'severity',
  'surface',
  'network_name',
  'wallet_component',
] as const;

export function normalizeAnalyticsFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isForbiddenAnalyticsIdentifierKey(key: string): boolean {
  return forbiddenAnalyticsIdentifierKeySet.has(normalizeAnalyticsFieldKey(key));
}

export function isAllowedGameAnalyticsCustomFieldKey(key: string): boolean {
  const normalized = normalizeAnalyticsFieldKey(key);
  return gameAnalyticsAllowedCustomFieldKeySet.has(normalized) && !forbiddenAnalyticsIdentifierKeySet.has(normalized);
}

export function isAllowedGameAnalyticsCustomFieldKeyForEvent(eventId: CanonicalAnalyticsEventId, key: string): boolean {
  const normalized = normalizeAnalyticsFieldKey(key);
  const eventAllowedFields = gameAnalyticsAllowedCustomFieldKeySetsByEventId.get(eventId);
  return eventAllowedFields !== undefined
    && eventAllowedFields.has(normalized)
    && !forbiddenAnalyticsIdentifierKeySet.has(normalized);
}

export function looksSensitiveAnalyticsValue(value: string): boolean {
  return (
    /https?:\/\//i.test(value) ||
    /www\./i.test(value) ||
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(value) ||
    /\bgpa\.\d{4}-\d{4}-\d{4}-\d{5}\b/i.test(value) ||
    /\b(?:txn|tx|transaction|receipt|token|purchase|order|device|ad[-_]?impression)[-_:.]?(?=[a-z0-9]*\d)[a-z0-9]{6,}\b/i.test(value) ||
    /\beyj[a-z0-9_-]+\.[a-z0-9_-]+/i.test(value) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value) ||
    /\b[0-7][0-9a-hjkmnp-tv-z]{25}\b/i.test(value) ||
    /\b\d{12,}\b/.test(value) ||
    /\b[a-f0-9]{32,}\b/i.test(value) ||
    /\b(?=[A-Za-z0-9_-]{24,}\b)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]+\b/.test(value)
  );
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
