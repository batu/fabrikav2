import { createTypedEventEmitter } from '@fabrikav2/kernel';

type ScaffoldEventMap = {
  'level:complete': { levelId: string };
  'level:fail': { levelId: string };
};

export const scaffoldEvents = createTypedEventEmitter<ScaffoldEventMap>();
