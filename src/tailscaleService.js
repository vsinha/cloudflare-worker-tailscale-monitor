import { getTailscaleAccessToken } from "./tailscaleAuthService.js";

/**
 * Configuration object for fetching Tailscale node details.
 * @typedef {object} TailscaleConfig
 * @property {string} tailnetName - The name of the Tailscale tailnet (e.g., "your-tailnet.com" or your organization name).
 * @property {number} downThresholdMinutes - The threshold in minutes to consider a device offline.
 * If a device's `lastSeen` is older than this, it's marked `isOnline: false`.
 * @property {string} [oauthClientId] - (Optional if using API key) The OAuth Client ID for Tailscale API authentication.
 * @property {string} [oauthClientSecret] - (Optional if using API key) The OAuth Client Secret for Tailscale API authentication.
 * @property {string} [apiKey] - (Optional if using OAuth) The Tailscale API key for authentication.
 * @property {string} [apiBaseUrl] - (Optional) The base URL for the Tailscale API, defaults to 'https://api.tailscale.com'.
 */

/**
 * Detailed information about a Tailscale device.
 * @typedef {object} TailscaleDeviceDetails
 * @property {string} id - The unique identifier of the device.
 * @property {string} name - The user-friendly name of the device (often includes the hostname and tailnet).
 * @property {string} hostname - The hostname of the device.
 * @property {string|null} tailscaleIp - The first Tailscale IP address of the device, if available.
 * @property {boolean} isOnline - Whether the device is considered online based on `lastSeen` and `downThresholdMinutes`.
 * @property {string} lastSeen - The ISO 8601 timestamp of when the device was last seen.
 * @property {string} os - The operating system of the device.
 * @property {number} minutesSinceLastSeen - The number of minutes since the device was last seen, rounded to the nearest minute.
 * @property {string[]} tags - An array of tags associated with the device.
 */

/**
 * Fetches detailed information for all devices within a specified Tailscale tailnet.
 *
 * This asynchronous function first obtains an access token using `getTailscaleAccessToken`.
 * It then queries the Tailscale API for all devices in the given tailnet.
 * For each device, it determines if it's "online" based on its `lastSeen` status
 * relative to the `downThresholdMinutes` specified in the configuration.
 *
 * @async
 * @param {TailscaleConfig} config - The configuration object containing tailnet name,
 * authentication details (for `getTailscaleAccessToken`),
 * and the online/offline threshold.
 * @returns {Promise<{success: boolean, devices: TailscaleDeviceDetails[], message?: string}>}
 * A promise that resolves to an object.
 * If successful, `success` is true and `devices` is an array of {@link TailscaleDeviceDetails}.
 * If no devices are found, `success` is true, `devices` is an empty array, and a `message` is included.
 * If an API error occurs, the promise will reject with an Error.
 * @throws {Error} If there's an issue fetching the access token or an error occurs with the Tailscale API request.
 */

export async function getTailscaleNodeDetails(config) {
  const accessToken = await getTailscaleAccessToken(config);

  const { tailnetName, downThresholdMinutes } = config;

  const apiUrl = `https://api.tailscale.com/api/v2/tailnet/${tailnetName}/devices?fields=all`;
  let devicesDetails = [];

  console.log("Fetching Tailscale device details (high sensitivity mode)...");
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Tailscale API error: ${response.status} ${response.statusText} - ${errorText}`
    );
    throw new Error(`Tailscale API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const devices = data.devices || [];

  if (devices.length === 0) {
    console.log("No devices found in the tailnet.");
    return { success: true, devices: [], message: "No devices found" };
  }

  const now = new Date();

  for (const device of devices) {
    const deviceName = device.name;
    const lastSeenDate = new Date(device.lastSeen);
    const minutesSinceLastSeen =
      (now.getTime() - lastSeenDate.getTime()) / (1000 * 60);

    // A device is considered "online" if it was seen within the downThresholdMinutes.
    // downThresholdMinutes defines what "recent enough" means to be considered active/online.
    const isOnline = minutesSinceLastSeen <= downThresholdMinutes;

    console.log(`--- Processing Device: ${deviceName} (ID: ${device.id}) ---`);
    console.log(
      `Raw lastSeen: ${device.lastSeen}, Parsed: ${lastSeenDate.toISOString()}`
    );
    console.log(`MinutesSinceLastSeen: ${minutesSinceLastSeen.toFixed(2)}`);
    console.log(
      `Is ${minutesSinceLastSeen.toFixed(
        2
      )} <= ${downThresholdMinutes}? ${isOnline}`
    );
    console.log(`Device Tags from API: ${JSON.stringify(device.tags)}`);
    console.log(`Determined isOnline status: ${isOnline}`);

    devicesDetails.push({
      id: device.id,
      name: deviceName,
      hostname: device.hostname,
      tailscaleIp:
        device.addresses && device.addresses.length > 0
          ? device.addresses[0]
          : null,
      isOnline: isOnline,
      lastSeen: device.lastSeen,
      os: device.os,
      minutesSinceLastSeen: Math.round(minutesSinceLastSeen),
      tags: device.tags || [],
    });
  }

  console.log(`Processed ${devicesDetails.length} devices.`);
  console.log(`All nodes data: ${JSON.stringify(devices, null, 2)}`);
  return { success: true, devices: devicesDetails };
}
