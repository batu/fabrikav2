import { describe, expect, it } from 'vitest';
import {
  COMEBACK_DELAY_DAYS,
  COMEBACK_REMINDER_ID,
  NotificationService,
  REMINDER_HOUR_LOCAL,
  STREAK_REMINDER_ID,
  planReminders,
  reminderTime,
  type NotificationPermission,
  type NotificationProvider,
  type ReminderInputs,
  type ScheduledReminder,
} from '../../src/notifications/NotificationService';
import type { LifecycleHooks } from '../../src/platform/gameLifecycle';

class FakeProvider implements NotificationProvider {
  permission: NotificationPermission = 'prompt';
  requestResult: NotificationPermission = 'granted';
  requestCalls = 0;
  cancelAllCalls = 0;
  scheduled: ScheduledReminder[][] = [];

  checkPermission(): Promise<NotificationPermission> {
    return Promise.resolve(this.permission);
  }

  requestPermission(): Promise<NotificationPermission> {
    this.requestCalls += 1;
    this.permission = this.requestResult;
    return Promise.resolve(this.requestResult);
  }

  schedule(reminders: readonly ScheduledReminder[]): Promise<void> {
    this.scheduled.push([...reminders]);
    return Promise.resolve();
  }

  cancelAll(): Promise<void> {
    this.cancelAllCalls += 1;
    return Promise.resolve();
  }
}

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

interface Harness {
  service: NotificationService;
  provider: FakeProvider;
  storage: ReturnType<typeof fakeStorage>;
  hooks: () => LifecycleHooks;
  flush: () => Promise<void>;
}

function makeHarness(overrides: {
  now?: Date;
  inputs?: ReminderInputs;
  notificationsOn?: boolean;
  permissionPromptLaunch?: number;
} = {}): Harness {
  const provider = new FakeProvider();
  const storage = fakeStorage();
  let registered: LifecycleHooks | null = null;
  const service = new NotificationService({
    provider,
    now: () => overrides.now ?? new Date(2026, 6, 21, 12, 0, 0),
    storage,
    registerHooks: (_id, hooks) => {
      registered = hooks;
      return () => undefined;
    },
    reminderInputs: () => overrides.inputs ?? { streakDays: 0, totalLevelsCompleted: 0 },
    notificationsOn: () => overrides.notificationsOn ?? true,
    permissionPromptLaunch: overrides.permissionPromptLaunch,
  });
  return {
    service,
    provider,
    storage,
    hooks: () => {
      if (registered === null) throw new Error('install() has not registered lifecycle hooks');
      return registered;
    },
    // Suspend/resume handlers are fire-and-forget; drain their microtasks.
    flush: async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

describe('reminderTime', () => {
  it('lands on the reminder hour at least the requested days ahead', () => {
    const now = new Date(2026, 6, 21, 12, 0, 0);
    const at = reminderTime(now, 1);
    expect(at.getHours()).toBe(REMINDER_HOUR_LOCAL);
    expect(at.getDate()).toBe(22);
  });

  it('never schedules in the past when now is after the reminder hour', () => {
    const now = new Date(2026, 6, 21, 23, 30, 0);
    const at = reminderTime(now, 0);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('planReminders', () => {
  it('plans streak + comeback reminders while a streak is alive', () => {
    const now = new Date(2026, 6, 21, 12, 0, 0);
    const plan = planReminders(now, { streakDays: 4, totalLevelsCompleted: 10 });
    expect(plan.map((r) => r.id)).toEqual([STREAK_REMINDER_ID, COMEBACK_REMINDER_ID]);
    expect(plan[0].body).toContain('4-day streak');
    expect(plan[1].at.getDate()).toBe(21 + COMEBACK_DELAY_DAYS);
  });

  it('plans only the comeback reminder with no streak', () => {
    const plan = planReminders(new Date(2026, 6, 21, 12, 0, 0), { streakDays: 0, totalLevelsCompleted: 0 });
    expect(plan.map((r) => r.id)).toEqual([COMEBACK_REMINDER_ID]);
  });
});

describe('NotificationService suspend/resume scheduling', () => {
  it('schedules planned reminders on suspend when permission is granted', async () => {
    const h = makeHarness({ inputs: { streakDays: 2, totalLevelsCompleted: 5 } });
    h.provider.permission = 'granted';
    h.service.install();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(1);
    expect(h.provider.scheduled[0].map((r) => r.id)).toEqual([STREAK_REMINDER_ID, COMEBACK_REMINDER_ID]);
  });

  it('schedules nothing on suspend without OS permission', async () => {
    const h = makeHarness();
    h.provider.permission = 'denied';
    h.service.install();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(0);
  });

  it('schedules nothing on suspend when the reminders setting is off', async () => {
    const h = makeHarness({ notificationsOn: false });
    h.provider.permission = 'granted';
    h.service.install();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(0);
  });

  it('cancels pending reminders on resume', async () => {
    const h = makeHarness();
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    const before = h.provider.cancelAllCalls;
    h.hooks().onResume?.(0);
    await h.flush();
    expect(h.provider.cancelAllCalls).toBe(before + 1);
  });
});

describe('NotificationService permission prompting', () => {
  it('does not prompt on the first app open', async () => {
    const h = makeHarness();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
  });

  it('prompts exactly once, on the second app open', async () => {
    const h = makeHarness();
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(1);
  });

  it('honors a configured permissionPromptLaunch', async () => {
    const h = makeHarness({ permissionPromptLaunch: 3 });
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(1);
  });

  it('does not auto-prompt when the reminders setting is off', async () => {
    const h = makeHarness({ notificationsOn: false });
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
  });

  it('setEnabled(true) requests permission when never granted', async () => {
    const h = makeHarness();
    h.provider.permission = 'prompt';
    await h.service.setEnabled(true);
    expect(h.provider.requestCalls).toBe(1);
  });

  it('setEnabled(false) cancels pending reminders without prompting', async () => {
    const h = makeHarness();
    await h.service.setEnabled(false);
    expect(h.provider.cancelAllCalls).toBe(1);
    expect(h.provider.requestCalls).toBe(0);
  });
});
