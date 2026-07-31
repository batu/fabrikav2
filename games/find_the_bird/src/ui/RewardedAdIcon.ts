export function rewardedAdIconMarkup(extraClass: string = ''): string {
  return `
    <span class="${rewardedAdIconClassName(extraClass)}" aria-hidden="true">
      <span class="rewarded-ad-icon-label">AD</span>
      <span class="rewarded-ad-icon-video">
        <span class="rewarded-ad-icon-play"></span>
      </span>
    </span>
  `;
}

export function createRewardedAdIcon(extraClass: string = ''): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = rewardedAdIconClassName(extraClass);
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'rewarded-ad-icon-label';
  label.textContent = 'AD';

  const video = document.createElement('span');
  video.className = 'rewarded-ad-icon-video';

  const play = document.createElement('span');
  play.className = 'rewarded-ad-icon-play';
  video.appendChild(play);

  icon.append(label, video);
  return icon;
}

function rewardedAdIconClassName(extraClass: string): string {
  const trimmed = extraClass.trim();
  return trimmed.length > 0 ? `rewarded-ad-icon ${trimmed}` : 'rewarded-ad-icon';
}
