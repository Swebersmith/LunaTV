/** Keep playback inside the custom player, including WebKit's inline mode. */
export function configureInlineVideo(video: HTMLVideoElement) {
  video.controls = false;
  video.removeAttribute('controls');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
}
