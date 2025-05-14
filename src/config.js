import { ensureRequiredEnv } from "./envChecker.js";

export const ALL_REQUIRED_KEYS = [
  "API_ACCESS_TOKEN_WORKER",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TAILNET_NAME",
  "TAILSCALE_OAUTH_CLIENT_ID",
  "TAILSCALE_OAUTH_CLIENT_SECRET",
  "TAILSCALE_NODE_STATUS_KV",
  "TAILSCALE_OAUTH_TOKEN_CACHE_KV",
  "DOWN_THRESHOLD_MINUTES",
  "REMINDER_INTERVAL_MINUTES",
  "MONITOR_TAGS",
  "TOKEN_KV_KEY",
  "TOKEN_EXPIRY_BUFFER_SECONDS",
];

/**
 * Loads and prepares configuration from environment variables after validating
 * that all required keys (defined in ALL_REQUIRED_KEYS) are present.
 * @param {object} env - The environment object containing secrets/bindings.
 * @returns {object} A configuration object with processed values.
 * @throws {Error} If required env vars are missing.
 */
export function loadAppConfig(env) {
  ensureRequiredEnv(env, ALL_REQUIRED_KEYS);

  console.log("Loading application configuration...");

  const config = {
    apiAccessTokenWorker: env.API_ACCESS_TOKEN_WORKER,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    tailnetName: env.TAILNET_NAME,
    tsOauthClientId: env.TAILSCALE_OAUTH_CLIENT_ID,
    tsOauthClientSecret: env.TAILSCALE_OAUTH_CLIENT_SECRET,
    nodeStatusKV: env.TAILSCALE_NODE_STATUS_KV,
    tokenCacheKV: env.TAILSCALE_OAUTH_TOKEN_CACHE_KV,
    downThresholdMinutes: parseInt(env.DOWN_THRESHOLD_MINUTES, 10),
    reminderIntervalMinutes: parseInt(env.REMINDER_INTERVAL_MINUTES, 10),
    monitorTags: (env.MONITOR_TAGS || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0), // Parse MONITOR_TAGS into an array of trimmed, non-empty tags
    tokenKVKey: env.TOKEN_KV_KEY,
    tokenExpiryBufferSeconds: env.TOKEN_EXPIRY_BUFFER_SECONDS,
  };

  console.log("Application configuration loaded successfully.");
  return config;
}
