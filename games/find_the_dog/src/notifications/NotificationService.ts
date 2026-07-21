import { Capacitor } from '@capacitor/core';
import { gameState } from '../core/GameState';
import { registerLifecycleHooks } from '../platform/gameLifecycle';
import { analytics } from '../analytics/AnalyticsService';

// Local retention notifications. Scheduling happens on app suspend (the last
// foreground moment iOS gives us) and every pending reminder is cancelled on
// resume, so a player who comes back never sees a stale nudge. Only two
// reminders exist, with fixed ids so re-scheduling replaces rather than
// accumulates.

/** Streak-save reminder: fires the next evening while a streak is alive. */
export const STREAK_REMINDER_ID = 1001;
/** Comeback nudge: fires after a multi-day absence. */
export const COMEBACK_REMINDER_ID = 1002;

/** Local hour (0-23) reminders aim for — evening, when play sessions peak. */
export const REMINDER_HOUR_LOCAL = 19;
export const COMEBACK_DELAY_DAYS = 3;

const PERMISSION_ASKED_KEY = 'ftd_notification_permission_asked';
const LAUNCH_COUNT_KEY = 'ftd_notification_launch_count';
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
  cancelAll(): Promise<void>;
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
  getPending(): Promise<{ notifications: Array<{ id: number }> }>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
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
    async cancelAll(): Promise<void> {
      const { LocalNotifications } = await loader();
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length === 0) return;
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(({ id }) => ({ id })),
      });
    },
  };
}

/** Inert provider for web builds and environments without the plugin. */
export const noopNotificationProvider: NotificationProvider = {
  checkPermission: () => Promise.resolve('denied'),
  requestPermission: () => Promise.resolve('denied'),
  schedule: () => Promise.resolve(),
  cancelAll: () => Promise.resolve(),
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

export interface ReminderInputs {
  readonly streakDays: number;
  readonly totalLevelsCompleted: number;
}

/** Pure planning: which reminders a suspend at `now` should leave behind. */
export function planReminders(now: Date, inputs: ReminderInputs): ScheduledReminder[] {
  const reminders: ScheduledReminder[] = [];
  if (inputs.streakDays > 0) {
    reminders.push({
      id: STREAK_REMINDER_ID,
      title: 'Your streak is waiting! 🐶',
      body: `Find a dog today to keep your ${inputs.streakDays}-day streak alive.`,
      at: reminderTime(now, 1),
    });
  }
  reminders.push({
    id: COMEBACK_REMINDER_ID,
    title: 'The dogs miss you! 🐾',
    body: inputs.totalLevelsCompleted > 0
      ? 'New scenes are waiting to be searched. Come find the dog!'
      : 'Your first dog is still hiding. Come find it!',
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
        void this.deps.provider.cancelAll().catch(logNotificationError);
      },
    });
    void this.deps.provider.checkPermission()
      .then((permission): void => {
        this.permission = permission;
        if (permission === 'granted') void this.deps.provider.cancelAll().catch(logNotificationError);
      })
      .catch(logNotificationError);
  }

  /** One-time automatic OS permission prompt on the second app open — the
   *  player has come back once, so the ask lands on demonstrated interest and
   *  never interrupts a first impression. Counts bootstrap runs; the settings
   *  toggle can re-ask later via setEnabled(true). */
  async maybePromptOnLaunch(): Promise<void> {
    const launches = this.bumpLaunchCount();
    if (!this.deps.notificationsOn()) return;
    if (launches < (this.deps.permissionPromptLaunch ?? DEFAULT_PERMISSION_PROMPT_LAUNCH)) return;
    if (this.deps.storage.getItem(PERMISSION_ASKED_KEY) !== null) return;
    if ((await this.deps.provider.checkPermission()) !== 'prompt') return;
    this.deps.storage.setItem(PERMISSION_ASKED_KEY, '1');
    this.permission = await this.deps.provider.requestPermission();
    void analytics.settingsChanged({
      setting_name: 'notificationPermission',
      new_value: this.permission,
    });
  }

  /** Settings-toggle path: turning reminders on requests OS permission if it
   *  was never granted; turning them off cancels everything pending. */
  async setEnabled(on: boolean): Promise<void> {
    if (!on) {
      await this.deps.provider.cancelAll().catch(logNotificationError);
      return;
    }
    this.deps.storage.setItem(PERMISSION_ASKED_KEY, '1');
    this.permission = await this.deps.provider.checkPermission();
    if (this.permission === 'prompt') {
      this.permission = await this.deps.provider.requestPermission();
    }
  }

  private bumpLaunchCount(): number {
    const raw = this.deps.storage.getItem(LAUNCH_COUNT_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    const next = (Number.isFinite(parsed) && parsed >= 0 ? parsed : 0) + 1;
    this.deps.storage.setItem(LAUNCH_COUNT_KEY, String(next));
    return next;
  }

  private async scheduleOnSuspend(): Promise<void> {
    try {
      if (!this.deps.notificationsOn()) return;
      this.permission = await this.deps.provider.checkPermission();
      if (this.permission !== 'granted') return;
      await this.deps.provider.cancelAll();
      await this.deps.provider.schedule(planReminders(this.deps.now(), this.deps.reminderInputs()));
    } catch (err) {
      logNotificationError(err);
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
  }),
  notificationsOn: () => gameState.settings.notificationsOn,
});
