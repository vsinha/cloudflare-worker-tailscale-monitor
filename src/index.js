import { loadAppConfig } from "./config.js";
import { getTailscaleNodeDetails } from "./tailscaleService.js";
import {
  sendTelegramNotification,
  escapeMarkdownV2,
} from "./telegramNotifier.js";

/**
 * @typedef {object} StoredNodeState
 * @property {'ONLINE' | 'OFFLINE' | null} state - The last known state of the node. Null if unknown.
 * @property {number} alertTs - Timestamp (milliseconds since epoch) of the last alert sent for the current state. 0 if no alert sent or node is online.
 * @property {number} firstDownTs - Timestamp (milliseconds since epoch) when the node was first detected as OFFLINE in the current outage period. 0 if node is online or was never offline.
 */

/**
 * @typedef {object} TailscaleDevice
 * @property {string} id - The unique identifier of the device.
 * @property {string} name - The user-friendly name of the device.
 * @property {string[]} tags - An array of tags associated with the device.
 * @property {boolean} isOnline - Whether the device is currently considered online.
 * @property {string} lastSeen - ISO 8601 timestamp of when the device was last seen.
 * @property {number} minutesSinceLastSeen - Minutes since the device was last seen.
 * // ... other properties from getTailscaleNodeDetails might be present
 */

/**
 * @typedef {object} TailscaleStatusResult
 * @property {boolean} success - Whether the operation to get node details was successful.
 * @property {TailscaleDevice[]} [devices] - Array of Tailscale device details.
 * @property {string} [message] - An optional message, e.g., "No devices found" or an error description.
 */

/**
 * @typedef {import('./config.js').AppConfig} AppConfig - The application configuration loaded from environment variables.
 * This would typically include:
 * @property {string} telegramBotToken
 * @property {string} telegramChatId
 * @property {string[]} [monitorTags]
 * @property {number} reminderIntervalMinutes
 * @property {KVNamespace} nodeStatusKV - The KV namespace for storing node statuses.
 * @property {string} [apiAccessTokenWorker] - Access token for the fetch endpoint.
 * // ... other config properties
 */

/**
 * Cloudflare Worker for monitoring Tailscale node statuses.
 *
 * This worker has two main functions:
 * 1. `scheduled`: Triggered by a cron schedule, it checks the status of Tailscale nodes,
 * sends Telegram notifications for changes in status (online/offline),
 * and stores the state of each node in a KV namespace.
 * 2. `Workspace`: Provides an HTTP GET endpoint to retrieve the current status of all
 * monitored nodes from the KV namespace.
 */

export default {
  /**
   * Handles scheduled events (cron triggers).
   * Fetches Tailscale node statuses, compares with previous statuses stored in KV,
   * sends Telegram notifications for changes (newly offline, still offline reminders, recovered online),
   * and updates the KV store with the latest status and alert timestamps.
   *
   * @async
   * @param {ScheduledController} controller - Contains information about the scheduled event, like `scheduledTime` and `cron`.
   * @param {AppConfig & Record<string, any>} env - Environment bindings, including secrets and the KV namespace (`nodeStatusKV`).
   * `loadAppConfig` is expected to process this.
   * @param {ExecutionContext} ctx - The execution context, used for `ctx.waitUntil` to extend the lifetime of operations.
   * @returns {Promise<void>}
   */

  async scheduled(controller, env, ctx) {
    let config;
    try {
      config = loadAppConfig(env);
    } catch (error) {
      console.error(error.message);
      return;
    }

    try {
      console.log(
        `Cron triggered at: ${new Date(
          controller.scheduledTime
        ).toISOString()}, Cron: ${controller.cron}`
      );

      ctx.waitUntil(
        getTailscaleNodeDetails(config)
          .then(async (statusResult) => {
            if (statusResult.success === false) {
              const errorMessage = escapeMarkdownV2(
                statusResult.message ||
                  "Failed to get node details for scheduled check."
              );
              await sendTelegramNotification(
                `🚨 *Worker Error\\!* ${errorMessage}`,
                config.telegramBotToken,
                config.telegramChatId
              );
              return;
            }

            if (statusResult.message === "No devices found") {
              await sendTelegramNotification(
                "ℹ️ No Tailscale devices found in the tailnet\\.",
                config.telegramBotToken,
                config.telegramChatId
              );
              return;
            }

            for (const node of statusResult.devices) {
              if (config.monitorTags && config.monitorTags.length > 0) {
                const deviceHasRequiredTag = node.tags.some((deviceTag) =>
                  config.monitorTags.includes(deviceTag)
                );
                if (!deviceHasRequiredTag) {
                  console.log(
                    `Skipping node ${node.name} (ID: ${
                      node.id
                    }) as it lacks any of the configured monitor tags: [${config.monitorTags.join(
                      ", "
                    )}]`
                  );
                  continue;
                } else {
                  console.log(
                    `Node ${node.name} (ID: ${node.id}) has a required monitor tag. Proceeding with status check.`
                  );
                }
              } else {
                console.log(
                  "No MONITOR_TAGS configured, processing all devices."
                );
              }

              console.log(
                `Node: ${node.name} \n Status: ${node.isOnline}`,
                node
              );
              const nodeId = node.id;
              const shortNodeName = node.name.split(".")[0];
              const kvKey = `node:${nodeId}:${shortNodeName}`;

              // Get previous state object from KV: { state: 'ONLINE'/'OFFLINE', alertTs: timestamp, firstDownTs: timestamp }
              const storedStateJSON = await config.nodeStatusKV.get(kvKey);
              const previousStateData = storedStateJSON
                ? JSON.parse(storedStateJSON)
                : { state: null, alertTs: 0, firstDownTs: 0 };

              const escapedDeviceName = escapeMarkdownV2(
                node.name.split(".")[0]
              );
              const lastSeenISO = escapeMarkdownV2(node.lastSeen);
              const minutesAgo = node.minutesSinceLastSeen;
              const now = Date.now(); // Current timestamp in milliseconds

              let needsKVWrite = false;
              let newKVData = { ...previousStateData };

              if (node.isOnline === false) {
                let firstDownTimestamp =
                  previousStateData.state === "OFFLINE" &&
                  previousStateData.firstDownTs
                    ? previousStateData.firstDownTs
                    : now;
                let message = `🚨 *${escapedDeviceName} OFFLINE*\n\nLast Seen: ${lastSeenISO} \\(${minutesAgo} mins ago\\)`;

                if (previousStateData.state !== "OFFLINE") {
                  // State changed: ONLINE (or null) -> OFFLINE
                  // It just went down (or was previously unknown and is now offline)
                  console.warn(
                    `Device ${node.name} just went OFFLINE. Sending initial alert.`
                  );
                  firstDownTimestamp = now; // Set/reset the first down timestamp
                  // Add duration if you want: (this part is tricky if firstDownTs was 0 from a null previousState)
                  // message += `\nStatus: Went OFFLINE just now.`;
                  await sendTelegramNotification(
                    message,
                    config.telegramBotToken,
                    config.telegramChatId
                  );
                  newKVData = {
                    state: "OFFLINE",
                    alertTs: now,
                    firstDownTs: firstDownTimestamp,
                  };
                  needsKVWrite = true;
                } else {
                  // It was already OFFLINE, check if it's time for a reminder
                  const minutesSinceLastAlert =
                    (now - previousStateData.alertTs) / (1000 * 60); // previousStateData.alertTs should be valid if state was 'OFFLINE'
                  if (minutesSinceLastAlert >= config.reminderIntervalMinutes) {
                    const totalDownMinutes = Math.round(
                      (now - firstDownTimestamp) / (1000 * 60)
                    );
                    message = `⏰ *${escapedDeviceName} STILL OFFLINE*\n\nLast Seen: ${lastSeenISO} \\(${minutesAgo} mins ago\\)\nOutage Duration: Approx ${totalDownMinutes} mins`;
                    console.warn(
                      `Device ${node.name} is STILL OFFLINE. Sending reminder alert.`
                    );
                    await sendTelegramNotification(
                      message,
                      config.telegramBotToken,
                      config.telegramChatId
                    );
                    newKVData = {
                      state: "OFFLINE",
                      alertTs: now,
                      firstDownTs: firstDownTimestamp,
                    };
                    needsKVWrite = true;
                  } else {
                    console.log(
                      `Device ${node.name} is still OFFLINE. Reminder interval not yet met.`
                    );
                  }
                }
              } else {
                if (previousStateData.state === "OFFLINE") {
                  // It just recovered
                  // State changed: OFFLINE -> ONLINE (Recovered)
                  const outageDurationMs =
                    now - (previousStateData.firstDownTs || now); // Handle case where firstDownTs might be 0
                  const outageDurationMinutes = Math.round(
                    outageDurationMs / (1000 * 60)
                  );
                  let message = `✅ *${escapedDeviceName} ONLINE*`;
                  if (
                    previousStateData.firstDownTs &&
                    outageDurationMinutes > 0
                  ) {
                    message += `\nWas OFFLINE for approx. ${outageDurationMinutes} mins.`;
                  }
                  console.log(
                    `Device ${node.name} changed to ONLINE. Sending resolved alert.`
                  );
                  await sendTelegramNotification(
                    message,
                    config.telegramBotToken,
                    config.telegramChatId
                  );
                  newKVData = { state: "ONLINE", alertTs: 0, firstDownTs: 0 }; // Reset alert timestamps
                  needsKVWrite = true;
                } else {
                  // Node is ONLINE and was already ONLINE, or is new and ONLINE
                  console.log(
                    `Device ${node.name} is ONLINE (or was already online/new).`
                  );
                  if (previousStateData.state === null) {
                    // New node, first seen as ONLINE
                    newKVData = { state: "ONLINE", alertTs: 0, firstDownTs: 0 };
                    needsKVWrite = true;
                  }
                }
              }
              if (needsKVWrite) {
                console.log(
                  `Updating KV for ${kvKey} to: ${JSON.stringify(newKVData)}`
                );
                await config.nodeStatusKV.put(kvKey, JSON.stringify(newKVData));
              }
            }
          })
          .catch(async (error) => {
            console.error(
              "Error during scheduled status check and alerting:",
              error.message,
              error.stack
            );
            const escapedErrorMessage = escapeMarkdownV2(error.message);
            await sendTelegramNotification(
              `🚨 *Worker Error\\!* Failed during scheduled check: ${escapedErrorMessage}`,
              config.telegramBotToken,
              config.telegramChatId
            );
          })
      );
    } catch (error) {
      console.error(
        "Synchronous error in scheduled handler (should be rare with this structure):",
        error.message,
        error.stack
      );
      const escapedErrorMessage = escapeMarkdownV2(error.message);
      await sendTelegramNotification(
        `🚨 *Worker Error\\!* Critical failure in scheduled handler: ${escapedErrorMessage}`,
        config.telegramBotToken,
        config.telegramChatId
      );
    }
  },

  /**
   * Handles incoming HTTP GET requests to retrieve node statuses from KV.
   * Requires an 'X-Auth-Token' header for authentication if `API_ACCESS_TOKEN_WORKER` is configured.
   *
   * @async
   * @param {Request} request - The incoming HTTP request object.
   * @param {AppConfig & Record<string, any>} env - Environment bindings, including secrets and the KV namespace.
   * @param {ExecutionContext} ctx - The execution context.
   * @returns {Promise<Response>} A Response object containing the status of nodes or an error.
   */
  async fetch(request, env, ctx) {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Method Not Allowed" }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            Allow: "GET",
          },
        }
      );
    }

    let config;
    try {
      config = loadAppConfig(env);
    } catch (error) {
      console.error(`Configuration Error for fetch: ${error.message}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Worker not configured: ${error.message}`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (
      config.apiAccessTokenWorker &&
      request.headers.get("X-Auth-Token") !== config.apiAccessTokenWorker
    ) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    try {
      const kvStoredStatuses = [];
      const listResult = await config.nodeStatusKV.list();

      for (const key of listResult.keys) {
        const storedValueJSON = await config.nodeStatusKV.get(key.name);
        if (storedValueJSON) {
          try {
            const storedValue = JSON.parse(storedValueJSON);
            const parts = key.name.split(":");

            if (parts.length === 3 && parts[0] === "node") {
              let humanReadableAlertTs = storedValue.alertTs;
              if (typeof storedValue.alertTs === "number") {
                if (storedValue.alertTs === 0) {
                  humanReadableAlertTs = null;
                } else {
                  humanReadableAlertTs = new Date(
                    storedValue.alertTs
                  ).toISOString();
                }
              }

              let humanReadableFirstDownTs = storedValue.firstDownTs;
              if (typeof storedValue.firstDownTs === "number") {
                if (storedValue.firstDownTs === 0) {
                  humanReadableFirstDownTs = null;
                } else {
                  humanReadableFirstDownTs = new Date(
                    storedValue.firstDownTs
                  ).toISOString();
                }
              }

              kvStoredStatuses.push({
                nodeId: parts[1],
                shortName: parts[2],
                status: {
                  state: storedValue.state,
                  alertTs: humanReadableAlertTs,
                  firstDownTs: humanReadableFirstDownTs,
                },
              });
            } else {
              console.warn(
                `Skipping KV key with unexpected format: ${key.name}`
              );
            }
          } catch (e) {
            console.error(
              `Error processing KV entry ${key.name}: ${e.message}. Value: ${storedValueJSON}`
            );
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, data: kvStoredStatuses }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error(
        "Fetch handler error while retrieving data from KV:",
        error.message,
        error.stack
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to retrieve statuses from KV: ${error.message}`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
