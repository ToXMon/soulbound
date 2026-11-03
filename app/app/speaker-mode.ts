// Browser-reported processing only: support is not proof of physical echo removal.
export const MICROPHONE_PROCESSING = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

export function microphoneReport(
  supported: MediaTrackSupportedConstraints,
  actual?: MediaTrackSettings,
): string {
  return Object.keys(MICROPHONE_PROCESSING).map((name) => {
    const key = name as keyof typeof MICROPHONE_PROCESSING;
    const value = actual?.[key];
    return `${key}: API support=${supported[key] === true ? "reported" : "not reported"}, actual=${typeof value === "boolean" ? String(value) : "not reported"}`;
  }).join("; ");
}
