import actionIconSurface from "./assets/icon-control-surface.png";
import actionPrimary from "./assets/button-surface-primary.png";
import actionSecondary from "./assets/button-surface-secondary.png";
import actionTestLose from "./assets/button-surface-test-lose.png";
import actionTestWin from "./assets/button-surface-test-win.png";
import currencyPrimary from "./assets/counter-frame-primary-currency.png";
import iconBack from "./assets/icon-control-back.png";
import iconConfirm from "./assets/icon-control-confirm.png";
import iconHaptics from "./assets/icon-control-haptics.png";
import iconHome from "./assets/icon-control-home.png";
import iconMusicOff from "./assets/icon-control-music-off.png";
import iconMusicOn from "./assets/icon-control-music-on.png";
import iconNext from "./assets/icon-control-next.png";
import iconPause from "./assets/icon-control-pause.png";
import iconPlay from "./assets/icon-control-play.png";
import iconRetry from "./assets/icon-control-retry.png";
import iconReturn from "./assets/icon-control-return.png";
import iconSettings from "./assets/icon-control-settings.png";
import nodeCompleted from "./assets/progression-node-completed.png";
import nodeCurrent from "./assets/progression-node-current.png";
import nodeLocked from "./assets/progression-node-locked.png";
import resultFail from "./assets/icon-control-result-fail.png";
import resultWin from "./assets/icon-control-result-win.png";

/** Semantic fixtures, not a theme authority. Exact origin lives in the seed manifest. */
export const assets = {
  action: {
    iconSurface: actionIconSurface,
    primary: actionPrimary,
    secondary: actionSecondary,
    testLose: actionTestLose,
    testWin: actionTestWin,
  },
  currency: { primary: currencyPrimary },
  icon: {
    back: iconBack,
    confirm: iconConfirm,
    haptics: iconHaptics,
    home: iconHome,
    musicOff: iconMusicOff,
    musicOn: iconMusicOn,
    next: iconNext,
    pause: iconPause,
    play: iconPlay,
    retry: iconRetry,
    return: iconReturn,
    settings: iconSettings,
  },
  node: { completed: nodeCompleted, current: nodeCurrent, locked: nodeLocked },
  result: { fail: resultFail, win: resultWin },
} as const;

export const assetUrls = {
  currency: assets.currency.primary,
  settings: assets.icon.settings,
  pause: assets.icon.pause,
  back: assets.icon.back,
  ribbonWin: assets.action.testWin,
  ribbonFail: assets.action.testLose,
  win: assets.result.win,
  fail: assets.result.fail,
} as const;

export type AssetSlotGroup = keyof typeof assets;
