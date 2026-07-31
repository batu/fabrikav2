import { DisabledAdProvider } from './DisabledAdProvider';

export class AdMobProvider extends DisabledAdProvider {
  constructor() {
    super('AdMob native adapter is supplied by @fabrikav2/sdk during device-stage wiring.');
  }
}
