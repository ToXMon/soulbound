/** Browser playback gate. No audio routing, capture, or track ownership. */
export function bindPlaybackGate(
  element: HTMLMediaElement,
  track: MediaStreamTrack,
  reset: () => void,
) {
  let disposed = false;
  // A track may be subscribed after its element has already started.
  let blocked = element.paused || element.ended || element.readyState < 3;
  const removers: Array<() => void> = [];
  function listen(target: EventTarget, event: string, callback: () => void) {
    target.addEventListener(event, callback);
    removers.push(() => target.removeEventListener(event, callback));
  }
  listen(element, "playing", () => { blocked = false; });
  for (const event of ["pause", "waiting", "stalled", "emptied", "ended", "error", "abort"]) {
    listen(element, event, () => { blocked = true; reset(); });
  }
  // Volume and track mute are instantaneous gates, not buffering latches:
  // unmuting need not emit another `playing` event.
  listen(element, "volumechange", reset);
  listen(track, "mute", reset);
  listen(track, "unmute", reset);
  listen(track, "ended", () => { blocked = true; reset(); });
  return {
    isOpen(contextRunning: boolean): boolean {
      return !disposed && !blocked && contextRunning && !element.paused &&
        !element.ended && !element.error && element.readyState >= 3 &&
        !element.muted && element.volume > 0 && track.enabled &&
        !track.muted && track.readyState === "live";
    },
    dispose() {
      disposed = true;
      for (const remove of removers) remove();
      reset();
    },
  };
}
