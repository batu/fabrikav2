import { Capacitor } from '@capacitor/core';
import { gameState } from '../core/GameState';
import { registerLifecycleHooks } from '../platform/gameLifecycle';
import { analytics } from '../analytics/AnalyticsService';

// Local retention notifications. Scheduling happens on app suspend (the last
// foreground moment iOS gives us) and every reminder is cancelled on resume,
// so a player who comes back never sees a stale nudge. Only two reminders
// exist, with fixed ids so re-scheduling replaces rather than accumulates.
//
// The suspend path is a SINGLE native bridge call (schedule with fixed ids —
// which replaces any pending copy) because iOS can freeze the WebView before
// a longer await chain completes. Permission is cached at install/resume/
// setEnabled rather than re-fetched during suspend for the same reason.
// A generation counter serializes suspend/resume: a resume that lands while
// a suspend's schedule() is still in flight bumps the generation, and the
// late schedule cleans up after itself when it sees the stale generation.

/** Streak-save reminder: fires while a streak is alive and at risk. */
export const STREAK_REMINDER_ID = 1001;
/** Comeback nudge: fires after a multi-day absence. */
export const COMEBACK_REMINDER_ID = 1002;
export const REMINDER_IDS: readonly number[] = [STREAK_REMINDER_ID, COMEBACK_REMINDER_ID];

/** Local hour (0-23) reminders aim for — evening, when play sessions peak. */
export const REMINDER_HOUR_LOCAL = 19;
export const COMEBACK_DELAY_DAYS = 3;

const PERMISSION_ASKED_KEY = 'game_notification_permission_asked';
const LAUNCH_COUNT_KEY = 'game_notification_launch_count';
/** Default app open (bootstrap run) on which the one-time OS prompt fires.
 *  Override per game via NotificationServiceDeps.permissionPromptLaunch. */
export const DEFAULT_PERMISSION_PROMPT_LAUNCH = 2;

export interface ScheduledReminder {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly at: Date;
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt';

/** Narrow seam over @capacitor/local-notifications so web builds and unit
 *  tests never touch the native plugin. */
export interface NotificationProvider {
  checkPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  schedule(reminders: readonly ScheduledReminder[]): Promise<void>;
  /** Cancel THIS feature's pending reminders (by fixed id — never other
   *  features' notifications) and clear its delivered ones from the tray. */
  cancelReminders(): Promise<void>;
}

type LocalNotificationsPlugin = {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
    }>;
  }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
  removeAllDeliveredNotifications(): Promise<void>;
};

export type LocalNotificationsLoader = () => Promise<{ LocalNotifications: LocalNotificationsPlugin }>;

const loadLocalNotifications: LocalNotificationsLoader = () => import('@capacitor/local-notifications');

function toPermission(display: string): NotificationPermission {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'prompt';
}

export function createCapacitorNotificationProvider(
  loader: LocalNotificationsLoader = loadLocalNotifications,
): NotificationProvider {
  return {
    async checkPermission(): Promise<NotificationPermission> {
      const { LocalNotifications } = await loader();
      return toPermission((await LocalNotifications.checkPermissions()).display);
    },
    async requestPermission(): Promise<NotificationPermission> {
      const { LocalNotifications } = await loader();
      return toPermission((await LocalNotifications.requestPermissions()).display);
    },
    async schedule(reminders: readonly ScheduledReminder[]): Promise<void> {
      if (reminders.length === 0) return;
      const { LocalNotifications } = await loader();
      await LocalNotifications.schedule({
        notifications: reminders.map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          schedule: { at: reminder.at },
        })),
      });
    },
    async cancelReminders(): Promise<void> {
      const { LocalNotifications } = await loader();
      await LocalNotifications.cancel({
        notifications: REMINDER_IDS.map((id) => ({ id })),
      });
      await LocalNotifications.removeAllDeliveredNotifications();
    },
  };
}

/** Inert provider for web builds and environments without the plugin. */
export const noopNotificationProvider: NotificationProvider = {
  checkPermission: () => Promise.resolve('denied'),
  requestPermission: () => Promise.resolve('denied'),
  schedule: () => Promise.resolve(),
  cancelReminders: () => Promise.resolve(),
};

/** Next occurrence of REMINDER_HOUR_LOCAL at least `minDays` calendar days
 *  ahead of `now` (exported for tests). */
export function reminderTime(now: Date, minDays: number): Date {
  const at = new Date(now.getTime());
  at.setDate(at.getDate() + minDays);
  at.setHours(REMINDER_HOUR_LOCAL, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** When the streak is at risk (no play yet today), the nudge must land TODAY —
 *  the streak dies at midnight. Aim for the evening hour; past it, fire soon;
 *  too close to midnight to deliver meaningfully, skip (null). */
export function streakAtRiskTime(now: Date): Date | null {
  const at = new Date(now.getTime());
  at.setHours(REMINDER_HOUR_LOCAL, 0, 0, 0);
  if (at.getTime() > now.getTime()) return at;
  const soon = new Date(now.getTime() + 90 * 60 * 1000);
  return soon.getDate() === now.getDate() ? soon : null;
}

export interface ReminderInputs {
  readonly streakDays: number;
  readonly totalLevelsCompleted: number;
  /** True when a completion was registered today — streak already safe. */
  readonly playedToday: boolean;
}

/** Pure planning: which reminders a suspend at `now` should leave behind. */
export function planReminders(now: Date, inputs: ReminderInputs): ScheduledReminder[] {
  const reminders: ScheduledReminder[] = [];
  if (inputs.streakDays > 0) {
    // Played today: streak is safe until tomorrow — remind tomorrow evening.
    // Not played today: streak dies at midnight — the nudge must land today.
    const at = inputs.playedToday ? reminderTime(now, 1) : streakAtRiskTime(now);
    if (at !== null) {
      reminders.push({
        id: STREAK_REMINDER_ID,
        title: 'Your streak is waiting! 🔥',
        body: `Play a level today to keep your ${inputs.streakDays}-day streak alive.`,
        at,
      });
    }
  }
  reminders.push({
    id: COMEBACK_REMINDER_ID,
    title: 'We miss you!',
    body: inputs.totalLevelsCompleted > 0
      ? 'New levels are waiting for you. Come back and play!'
      : 'Your first level is waiting. Come play!',
    at: reminderTime(now, COMEBACK_DELAY_DAYS),
  });
  return reminders;
}

export interface NotificationServiceDeps {
  readonly provider: NotificationProvider;
  readonly now: () => Date;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly registerHooks: typeof registerLifecycleHooks;
  readonly reminderInputs: () => ReminderInputs;
  readonly notificationsOn: () => boolean;
  /** App open on which the one-time OS permission prompt fires.
   *  Defaults to DEFAULT_PERMISSION_PROMPT_LAUNCH (second open). */
  readonly permissionPromptLaunch?: number;
}

export class NotificationService {
  private readonly deps: NotificationServiceDeps;
  private permission: NotificationPermission = 'prompt';
  /** Bumped by every resume; a suspend-time schedule that resolves under a
   *  stale generation cleans up after itself (resume already cancelled). */
  private generation = 0;

  constructor(deps: NotificationServiceDeps) {
    this.deps = deps;
  }

  /** Register suspend/resume scheduling and clear any stale pending reminders
   *  from the previous run. Call once at boot, after installGameLifecycle. */
  install(): void {
    this.deps.registerHooks('notifications', {
      onSuspend: (): void => {
        void this.scheduleOnSuspend();
      },
      onResume: (): void => {
        this.generation += 1;
        void this.refreshPermissionAndClear();
      },
    });
    void this.refreshPermissionAndClear();
  }

  /** One-time automatic OS permission prompt on the second app open — the
   *  player has come back once, so the ask lands on demonstrated interest and
   *  never interrupts a first impression. Counts bootstrap runs; the settings
   *  toggle can re-ask later via setEnabled(true). */
  async maybePromptOnLaunch(): Promise<void> {
    try {
      const launches = this.bumpLaunchCount();
      if (!this.deps.notificationsOn()) return;
      if (launches < (this.deps.permissionPromptLaunch ?? DEFAULT_PERMISSION_PROMPT_LAUNCH)) return;
      if (this.readStorage(PERMISSION_ASKED_KEY) !== null) return;
      if ((await this.deps.provider.checkPermission()) !== 'prompt') return;
      this.permission = await this.deps.provider.requestPermission();
      // Consume the one-shot only after the prompt actually resolved — an app
      // kill mid-dialog or a plugin failure must leave the ask available.
      this.writeStorage(PERMISSION_ASKED_KEY, '1');
      void analytics.settingsChanged({
        setting_name: 'notificationPermission',
        new_value: this.permission,
      });
    } catch (err) {
      logNotificationError(err);
    }
  }

  /** Settings-toggle path: turning reminders on requests OS permission if it
   *  was never granted; turning them off cancels everything pending. */
  async setEnabled(on: boolean): Promise<void> {
    try {
      if (!on) {
        await this.deps.provider.cancelReminders();
        return;
      }
      this.permission = await this.deps.provider.checkPermission();
      if (this.permission === 'prompt') {
        this.permission = await this.deps.provider.requestPermission();
        this.writeStorage(PERMISSION_ASKED_KEY, '1');
      }
    } catch (err) {
      logNotificationError(err);
    }
  }

  private async scheduleOnSuspend(): Promise<void> {
    try {
      if (!this.deps.notificationsOn()) return;
      // Cached permission: suspend must not spend bridge roundtrips — iOS may
      // freeze the WebView before a long await chain completes.
      if (this.permission !== 'granted') return;
      const generation = this.generation;
      await this.deps.provider.schedule(planReminders(this.deps.now(), this.deps.reminderInputs()));
      if (generation !== this.generation) {
        // The player resumed while schedule() was in flight and resume's
        // cancel may have run first — wipe what we just scheduled.
        await this.deps.provider.cancelReminders();
      }
    } catch (err) {
      logNotificationError(err);
    }
  }

  private async refreshPermissionAndClear(): Promise<void> {
    try {
      await this.deps.provider.cancelReminders();
      this.permission = await this.deps.provider.checkPermission();
    } catch (err) {
      logNotificationError(err);
    }
  }

  private bumpLaunchCount(): number {
    const raw = this.readStorage(LAUNCH_COUNT_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    const next = (Number.isFinite(parsed) && parsed >= 0 ? parsed : 0) + 1;
    this.writeStorage(LAUNCH_COUNT_KEY, String(next));
    return next;
  }

  // localStorage can throw (private mode, quota). Reminders are best-effort —
  // storage failure must never break the prompt flow or bubble to bootstrap.
  private readStorage(key: string): string | null {
    try {
      return this.deps.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      this.deps.storage.setItem(key, value);
    } catch {
      // best-effort
    }
  }
}

function logNotificationError(err: unknown): void {
  console.warn('[notifications] operation failed', err);
}

function defaultProvider(): NotificationProvider {
  return Capacitor.isNativePlatform()
    ? createCapacitorNotificationProvider()
    : noopNotificationProvider;
}

export const notificationService = new NotificationService({
  provider: defaultProvider(),
  now: () => new Date(),
  storage: typeof localStorage !== 'undefined'
    ? localStorage
    : { getItem: () => null, setItem: () => undefined },
  registerHooks: registerLifecycleHooks,
  reminderInputs: () => ({
    // currentStreakDays(), not the raw stored streakDays: the stored value goes
    // stale across multi-day gaps and would nudge players about a dead streak.
    streakDays: gameState.currentStreakDays(),
    totalLevelsCompleted: gameState.totalLevelsCompleted,
    playedToday: gameState.playedToday(),
  }),
  notificationsOn: () => gameState.settings.notificationsOn,
});
