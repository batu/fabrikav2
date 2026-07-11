import actionIconSurface from "./assets/action-icon-surface.png";
import actionPrimary from "./assets/action-primary.png";
import actionSecondary from "./assets/action-secondary.png";
import actionTestLose from "./assets/action-test-lose.png";
import actionTestWin from "./assets/action-test-win.png";
import currencyPrimary from "./assets/currency-primary.png";
import dividerPanel from "./assets/divider-panel.png";
import heroPlaceholder from "./assets/hero-placeholder.png";
import iconBack from "./assets/icon-back.png";
import iconConfirm from "./assets/icon-confirm.png";
import iconHaptics from "./assets/icon-haptics.png";
import iconHome from "./assets/icon-home.png";
import iconMusicOff from "./assets/icon-music-off.png";
import iconMusicOn from "./assets/icon-music-on.png";
import iconNext from "./assets/icon-next.png";
import iconPause from "./assets/icon-pause.png";
import iconPlay from "./assets/icon-play.png";
import iconRetry from "./assets/icon-retry.png";
import iconReturn from "./assets/icon-return.png";
import iconSettings from "./assets/icon-settings.png";
import nodeCompleted from "./assets/node-completed.png";
import nodeCurrent from "./assets/node-current.png";
import nodeLocked from "./assets/node-locked.png";
import resultFail from "./assets/result-fail.png";
import resultWin from "./assets/result-win.png";
import statusFailure from "./assets/status-failure.png";
import statusSuccess from "./assets/status-success.png";
import toggleOff from "./assets/toggle-off.png";
import toggleOn from "./assets/toggle-on.png";

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
  decoration: { dividerPanel, heroPlaceholder },
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
  status: { failure: statusFailure, success: statusSuccess },
  toggle: { off: toggleOff, on: toggleOn },
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
