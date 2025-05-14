/**
 * Represents the data structure of a successfully fetched Tailscale OAuth token.
 * @typedef {object} TailscaleOAuthTokenResponse
 * @property {string} access_token - The OAuth access token.
 * @property {number} expires_in - The duration in seconds for which the access token is valid.
 * @property {string} token_type - The type of token, typically "bearer".
 * // Other properties might be present but are not used by these functions.
 */

/**
 * Fetches a new Tailscale OAuth access token using the client credentials grant type.
 *
 * @async
 * @param {string} clientId - The Tailscale OAuth client ID.
 * @param {string} clientSecret - The Tailscale OAuth client secret.
 * @returns {Promise<TailscaleOAuthTokenResponse>} A promise that resolves to the token data object from Tailscale.
 * @throws {Error} If the OAuth token request to Tailscale API fails (e.g., network error, invalid credentials).
 */
async function fetchNewTailscaleAccessToken(clientId, clientSecret) {
  console.log("Fetching new Tailscale OAuth access token...");
  const tokenUrl = "https://api.tailscale.com/api/v2/oauth/token";

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      "Tailscale OAuth token request failed:",
      response.status,
      errorText
    );
    throw new Error(`Tailscale OAuth Error: ${response.status} - ${errorText}`);
  }

  const tokenData = await response.json();
  return tokenData;
}

/**
 * Configuration for retrieving a Tailscale access token.
 * @typedef {object} AccessTokenConfig
 * @property {string} tsOauthClientId - The Tailscale OAuth client ID.
 * @property {string} tsOauthClientSecret - The Tailscale OAuth client secret.
 * @property {KVNamespace} tokenCacheKV - The Cloudflare KV namespace used for caching the token.
 * @property {string} tokenKVKey - The key under which the token data is stored in the KV namespace.
 * @property {number} tokenExpiryBufferSeconds - A buffer in seconds to subtract from the token's actual
 * expiry time to consider it expired prematurely, ensuring it's refreshed before actual expiry.
 */

/**
 * Represents the data structure stored in KV for a cached Tailscale access token.
 * @typedef {object} CachedTokenData
 * @property {string} accessToken - The Tailscale OAuth access token.
 * @property {number} expiresAt - The timestamp (milliseconds since epoch) when the cached token should be considered expired (already includes the buffer).
 */

/**
 * Retrieves a Tailscale access token.
 * It first attempts to get a valid token from a KV cache. If a valid cached token is not found
 * (i.e., it's missing, expired, or there's an error reading it), it fetches a new token
 * from the Tailscale OAuth API, caches it in KV, and then returns it.
 *
 * @async
 * @param {AccessTokenConfig} config - Configuration object containing credentials, KV namespace,
 * KV key, and expiry buffer.
 * @returns {Promise<string>} A promise that resolves to the Tailscale access token string.
 * @throws {Error} If fetching a new token fails and no valid cached token is available.
 */

export async function getTailscaleAccessToken(config) {
  const { tsOauthClientId, tsOauthClientSecret, tokenCacheKV } = config;

  try {
    const cachedDataJson = await tokenCacheKV.get(config.tokenKVKey);
    if (cachedDataJson) {
      const cachedData = JSON.parse(cachedDataJson);
      // Check if token is still valid (with a buffer)
      if (
        cachedData.accessToken &&
        cachedData.expiresAt &&
        Date.now() < cachedData.expiresAt
      ) {
        console.log("Using cached Tailscale OAuth access token.");
        return cachedData.accessToken;
      }
    }
  } catch (e) {
    console.error("Error reading token from KV, will fetch new:", e.message);
  }

  const newTokenData = await fetchNewTailscaleAccessToken(
    tsOauthClientId,
    tsOauthClientSecret
  );

  const expiresAt =
    Date.now() +
    (newTokenData.expires_in - config.tokenExpiryBufferSeconds) * 1000;

  const dataToCache = {
    accessToken: newTokenData.access_token,
    expiresAt: expiresAt,
  };

  try {
    await tokenCacheKV.put(config.tokenKVKey, JSON.stringify(dataToCache), {
      expirationTtl:
        newTokenData.expires_in - config.tokenExpiryBufferSeconds / 2, // Cache a bit shorter than token validity
    });
    console.log("New Tailscale OAuth access token fetched and cached.");
  } catch (e) {
    console.error("Error writing token to KV:", e.message);
  }

  return newTokenData.access_token;
}
