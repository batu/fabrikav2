import {
  isAllowedGameAnalyticsCustomFieldKeyForEvent,
  looksSensitiveAnalyticsValue,
  type CanonicalAnalyticsEventId,
} from './CanonicalAnalyticsEvents';

export type GameAnalyticsPrimitive = string | number | boolean | null | undefined;
export type GameAnalyticsCustomFields = Record<string, GameAnalyticsPrimitive>;

export const GAMEANALYTICS_RESOURCE_CURRENCIES = ['coins', 'hints'] as const;
export const GAMEANALYTICS_RESOURCE_ITEM_TYPES = ['level', 'hint', 'continue', 'rewarded', 'shop', 'iap', 'offer'] as const;

export type GameAnalyticsProgressionStatus = 'start' | 'complete' | 'fail';
export type GameAnalyticsResourceFlowType = 'source' | 'sink';
export type GameAnalyticsCurrency = (typeof GAMEANALYTICS_RESOURCE_CURRENCIES)[number];
export type GameAnalyticsItemCategory = (typeof GAMEANALYTICS_RESOURCE_ITEM_TYPES)[number];
export type GameAnalyticsAdAction = 'clicked' | 'show' | 'failed_show' | 'reward_received' | 'request' | 'loaded';
export type GameAnalyticsAdType = 'video' | 'rewarded_video' | 'playable' | 'interstitial' | 'offer_wall' | 'banner';
export type GameAnalyticsAdSdkName = 'applovin' | 'admob';

export interface GameAnalyticsProgressionEvent {
  status: GameAnalyticsProgressionStatus;
  progression01: string;
  progression02?: string;
  progression03?: string;
  score?: number;
  customFields?: GameAnalyticsCustomFields;
}

export interface GameAnalyticsDesignEvent {
  eventId: string;
  value?: number;
  customFields?: GameAnalyticsCustomFields;
}

export interface GameAnalyticsResourceEvent {
  flowType: GameAnalyticsResourceFlowType;
  currency: GameAnalyticsCurrency;
  amount: number;
  category: GameAnalyticsItemCategory;
  itemId: string;
  customFields?: GameAnalyticsCustomFields;
}

export interface GameAnalyticsAdEvent {
  action: GameAnalyticsAdAction;
  adType: GameAnalyticsAdType;
  sdkName: GameAnalyticsAdSdkName;
  placement: string;
  customFields?: GameAnalyticsCustomFields;
}

export interface GameAnalyticsSink {
  readonly providerName: string;
  init: () => Promise<void>;
  trackProgression: (event: GameAnalyticsProgressionEvent) => Promise<void>;
  trackDesign: (event: GameAnalyticsDesignEvent) => Promise<void>;
  trackResource: (event: GameAnalyticsResourceEvent) => Promise<void>;
  trackAd: (event: GameAnalyticsAdEvent) => Promise<void>;
}

export function levelProgressionEvent(status: GameAnalyticsProgressionStatus, levelId: string, score?: number, customFields: GameAnalyticsCustomFields = {}): GameAnalyticsProgressionEvent {
  const canonicalEventId = canonicalEventIdForProgressionStatus(status);
  return {
    status,
    progression01: 'find_the_dog',
    progression02: segment(levelId),
    ...(score === undefined ? {} : { score }),
    customFields: compactCustomFields(canonicalEventId, customFields),
  };
}

export function designEvent(
  eventId: string,
  customFields: GameAnalyticsCustomFields = {},
  value?: number,
  canonicalEventId: CanonicalAnalyticsEventId | null = canonicalEventIdForDesignEvent(eventId),
): GameAnalyticsDesignEvent {
  return {
    eventId: eventPath(eventId),
    ...(value === undefined ? {} : { value }),
    customFields: canonicalEventId === null ? {} : compactCustomFields(canonicalEventId, customFields),
  };
}

export function resourceEvent(
  flowType: GameAnalyticsResourceFlowType,
  currency: GameAnalyticsCurrency,
  amount: number,
  category: GameAnalyticsItemCategory,
  itemId: string,
  customFields: GameAnalyticsCustomFields = {},
  canonicalEventId: CanonicalAnalyticsEventId = 'resource_changed',
): GameAnalyticsResourceEvent {
  return {
    flowType,
    currency,
    amount: Math.max(0, Math.round(amount)),
    category,
    itemId: segment(looksSensitiveAnalyticsValue(itemId) ? 'redacted' : itemId),
    customFields: compactCustomFields(canonicalEventId, customFields),
  };
}

export function adEvent(
  action: GameAnalyticsAdAction,
  adType: GameAnalyticsAdType,
  sdkName: GameAnalyticsAdSdkName,
  placement: string,
  customFields: GameAnalyticsCustomFields = {},
): GameAnalyticsAdEvent {
  const canonicalEventId = canonicalEventIdForAdAction(action);
  return {
    action,
    adType,
    sdkName,
    placement: segment(looksSensitiveAnalyticsValue(placement) ? 'redacted' : placement, 64),
    customFields: canonicalEventId === null ? {} : compactCustomFields(canonicalEventId, customFields),
  };
}

function eventPath(value: string): string {
  return value
    .split(':')
    .slice(0, 5)
    .map((part) => segment(part))
    .join(':');
}

function compactCustomFields(eventId: CanonicalAnalyticsEventId, fields: GameAnalyticsCustomFields): GameAnalyticsCustomFields {
  const compact: GameAnalyticsCustomFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Object.keys(compact).length >= 20) break;
    if (value === null || value === undefined) continue;
    if (!isAllowedGameAnalyticsCustomFieldKeyForEvent(eventId, key)) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (looksSensitiveAnalyticsValue(trimmed)) continue;
      compact[segment(key)] = trimmed.slice(0, 96);
    } else if (typeof value === 'number') {
      // GameAnalytics' validateAndCleanCustomFields (SDK 4.4.7) drops falsy
      // values via a `!value` check, so a literal 0 is silently omitted. Stringify
      // every number — not just 0 — so a single custom-field key carries one
      // stable type across events (dog_index='0' and '3', never '0' next to 3),
      // which a mixed numeric/string dimension would break for dashboard filters.
      // Numeric metrics ride the design/business event `value` field, not these
      // custom-field dimensions, so no aggregation is lost.
      if (Number.isFinite(value)) compact[segment(key)] = String(value);
    } else if (typeof value === 'boolean') {
      // The same validator drops non-string/non-number values, so a boolean true
      // is omitted entirely (and false is dropped as falsy). Stringify both so the
      // dimension always survives, matching the Firebase sink's boolean rule.
      compact[segment(key)] = String(value);
    }
  }
  return compact;
}

function canonicalEventIdForProgressionStatus(status: GameAnalyticsProgressionStatus): CanonicalAnalyticsEventId {
  switch (status) {
    case 'start':
      return 'level_start';
    case 'complete':
      return 'level_complete';
    case 'fail':
      return 'level_failed';
  }
}

function canonicalEventIdForDesignEvent(eventId: string): CanonicalAnalyticsEventId | null {
  const normalized = eventId.trim().toLowerCase();
  if (normalized === 'app:open') return 'app_open';
  if (normalized === 'dog:found') return 'dog_found';
  if (normalized === 'hint:used') return 'hint_used';
  if (normalized.startsWith('settings:')) return 'settings_changed';
  if (normalized === 'purchase:fulfilled') return 'purchase_fulfilled';
  if (normalized === 'purchase:unfulfilled') return 'purchase_unfulfilled';
  if (normalized === 'ad:revenue') return 'ad_revenue_paid';
  return null;
}

function canonicalEventIdForAdAction(action: GameAnalyticsAdAction): CanonicalAnalyticsEventId | null {
  switch (action) {
    case 'show':
      return 'ad_shown';
    case 'failed_show':
      return 'ad_show_failed';
    case 'reward_received':
      return 'rewarded_ad_granted';
    case 'request':
      return 'ad_requested';
    case 'loaded':
      return 'ad_loaded';
    case 'clicked':
      return null;
  }
}

function segment(value: string, maxLength: number = 32): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = normalized.length > 0 ? normalized : 'unknown';
  if (safe.length <= maxLength) return safe;

  const hash = shortHash(safe);
  const prefixLength = Math.max(1, maxLength - hash.length - 1);
  return `${safe.slice(0, prefixLength)}_${hash}`;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6).padStart(6, '0');
}
