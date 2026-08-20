// src/main/recording/resolveWasapiDevice.js

/**
 * Resolve a configured WASAPI audio source against the output devices present
 * right now.
 *
 * Windows regenerates WASAPI endpoint GUIDs when an audio driver is updated or
 * reinstalled (e.g. a SteelSeries Sonar update), so a deviceId stored in
 * settings can silently go stale while the device itself — identified by its
 * friendly name — is still attached. Trusting the stored id blindly makes
 * getDeviceFormat() throw "Failed to get device format" and kills the whole
 * recording, so the id is validated here and re-resolved by name when stale.
 *
 * @param {Array<{name: string, deviceId: string}>} devices - currently present
 *   output devices (from WasapiCapture.getOutputDevices()).
 * @param {{device: string, deviceId: string|null}} source - configured source;
 *   `device` is the friendly name, `deviceId` the stored endpoint id.
 * @returns {{deviceId: string, healed: boolean}|null} the id to record from
 *   (`healed` marks a stale id re-resolved by name), or null when the device
 *   is not present under either identity.
 */
function resolveWasapiDevice(devices, source) {
  if (source.deviceId && devices.some((d) => d.deviceId === source.deviceId)) {
    return { deviceId: source.deviceId, healed: false };
  }
  const byName = devices.find((d) => d.name === source.device);
  if (byName) {
    return { deviceId: byName.deviceId, healed: true };
  }
  return null;
}

module.exports = { resolveWasapiDevice };
