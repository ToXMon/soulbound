// Node 22 on this VPS lacks the global ErrorEvent used by @livekit/agents'
// error handling (worker.js:276). Minimal spec-shaped shim, loaded via
// `node --import ./polyfill-error-event.mjs dist/index.js`.
if (typeof globalThis.ErrorEvent === "undefined") {
  globalThis.ErrorEvent = class ErrorEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.message = init.message ?? "";
      this.error = init.error ?? null;
    }
  };
}
