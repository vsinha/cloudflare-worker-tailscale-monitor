# Tailscale Device Monitor - Cloudflare Worker

Monitor the status of your Tailscale devices and receive Telegram notifications for online/offline changes. This Cloudflare Worker periodically checks your Tailscale nodes, stores their state, and alerts you to status updates. It also provides an optional HTTP endpoint to fetch the current status of all monitored devices.

## Overview

This Cloudflare Worker provides a serverless solution for monitoring Tailscale devices. It leverages Tailscale’s OAuth API to fetch device information and Cloudflare’s KV store to maintain state and cache API tokens. Notifications for device status changes (offline, online, reminder for still offline) are sent via Telegram.

## Telegram Notifications

Here's an example of what the Telegram notifications look like:

![Tailscale Monitor Telegram Notification](assets/tg.png)

## Features

- **Scheduled Monitoring:** Automatically checks Tailscale device statuses on a configurable cron schedule.
- **Telegram Notifications:** Alerts for:
  - Device going **OFFLINE**.
  - Device coming back **ONLINE**.
  - Reminders if a device remains **OFFLINE** for a configurable duration.
  - Worker errors or issues fetching data.
- **Stateful Monitoring:** Remembers each device’s last known state using Cloudflare KV.
- **Tag-Based Monitoring:** Optionally monitor only devices with specific Tailscale tags.
- **OAuth 2.0 for Tailscale API:** Securely authenticates with the Tailscale API using OAuth client credentials.
- **KV Caching for API Tokens:** Efficiently manages Tailscale API access tokens by caching them in KV.
- **Status API Endpoint:** (Optional) A secured GET endpoint to retrieve the current status of all monitored devices from KV.
- **Configurable Thresholds:** Set how long a device must be unseen before being considered offline and the interval for offline reminder notifications.

## How it Works

The worker has two main functionalities:

1.  **Scheduled Handler (`scheduled`):**
    * Triggered by a cron schedule defined in your Cloudflare Worker settings.
    * Loads application configuration (API keys, tokens, settings) from environment variables.
    * Retrieves a Tailscale API access token (fetches a new one if the cached token is invalid or expired).
    * Fetches the list of devices from your Tailscale tailnet.
    * Filters devices based on `MONITOR_TAGS` if configured.
    * For each monitored device:
        * Compares its current status (online/offline based on `lastSeen` and `DOWN_THRESHOLD_MINUTES`) with the status stored in Cloudflare KV.
        * If a device goes OFFLINE: sends a Telegram notification and updates its KV record with the new state and `firstDownTs`.
        * If a device is already OFFLINE: checks if `REMINDER_INTERVAL_MINUTES` has passed since the last alert. If so, sends a reminder notification and updates the `alertTs` in KV.
        * If a device comes back ONLINE: sends a recovery notification and updates its KV record.
        * If a device is ONLINE and was ONLINE (or newly discovered as ONLINE): updates its KV record if it's the first time seeing it.
    * Handles errors during the process and sends error notifications to Telegram.

2.  **Fetch Handler (`Workspace`):**
    * Responds to HTTP GET requests.
    * If `API_ACCESS_TOKEN_WORKER` is configured, it requires an `X-Auth-Token` header for authentication.
    * Retrieves all stored node statuses from the `TAILSCALE_NODE_STATUS_KV` namespace.
    * Returns a JSON response containing the status of all monitored nodes (node ID, short name, state, last alert timestamp, first down timestamp).
    * Primarily used for external systems or dashboards to query the collected status data.

## Architecture Diagram (Conceptual Flow)
```text
                                     +--------------------------+
                                     | Cloudflare Worker        |
                                     | (Scheduled Cron Trigger) |
                                     +--------------------------+
                                                 |
                                                 v
                                       +------------------------+
                                       | Load Config (env vars) |
                                       +------------------------+
                                                 |
                                                 v
                             +---------------------------------------+
                             | tailscaleAuthService.js               |
                             | Get/Refresh Tailscale OAuth Token     |
                             | (Uses TAILSCALE_OAUTH_TOKEN_CACHE_KV) |
                             +---------------------------------------+
                                              | (Access Token)
                                              v
                                     +-------------------------------+
                                     | tailscaleService.js           |
                                     | Fetch Devices from Tailscale  |
                                     | API (using Access Token)      |
                                     +-------------------------------+
                                                 | (Device List & Status)
                                                 v
+-------------------------------+ <---> +----------------------------------+ <---> +-----------------------+
| Cloudflare KV                 |       | index.js (Scheduled Handler)     |       | telegramNotifier.js   |
| (TAILSCALE_NODE_STATUS_KV)    |       | Compare with previous state,     |       | Send Alerts via       |
| Store Device State            |       | Determine notifications          |       | Telegram Bot API      |
| {state, alertTs, firstDownTs} |       | Update KV                        |       |                       |
+-------------------------------+       +----------------------------------+       +-----------------------+
                                                      |
                                                      v
                                        HTTP Fetch Handler (optional)
                                                      |
                                                      v
                                     Returns JSON of all node statuses
```

## Prerequisites

* **Tailscale Account:** You need a Tailscale account and your Tailnet name.
* **Tailscale OAuth Client:** An OAuth client ID and secret from your Tailscale admin console (Admin -> Settings -> OAuth clients).
    * **Scopes Required:** `devices:read`
* **Telegram Bot:**
    * A Telegram Bot created via BotFather.
    * The Bot Token.
    * Your Telegram Chat ID (user ID or group ID where notifications will be sent).
* **Cloudflare Account:**
    * A Cloudflare account with Workers and KV enabled.

## Setup and Deployment

### 1. Prepare Your Code

You can either clone this repository (if you've set one up) or manually create the following files in your Cloudflare Worker project:

* `index.js` (Main worker logic)
* `config.js` (Configuration loader)
* `envChecker.js` (Environment variable validation)
* `tailscaleAuthService.js` (Handles Tailscale OAuth)
* `tailscaleService.js` (Fetches Tailscale device data)
* `telegramNotifier.js` (Sends Telegram messages)
* `wrangler.toml` (Cloudflare Worker configuration file)

### 2. Tailscale OAuth Client Setup

1.  Go to your Tailscale Admin Console.
2.  Navigate to **Settings -> OAuth clients**.
3.  Click **"Generate OAuth client..."**.
4.  Give it a descriptive name (e.g., "Cloudflare Worker Monitor").
5.  Ensure the **`devices:read`** scope is selected.
6.  Click **"Generate client"**.
7.  **Securely store the generated Client ID and Client Secret.** You will need these for the environment variables.

### 3. Telegram Bot Setup

1.  Open Telegram and search for "BotFather".
2.  Start a chat with BotFather and use the `/newbot` command.
3.  Follow the prompts to choose a name and username for your bot.
4.  BotFather will provide you with an **API Token**. Securely store this token.
5.  To get your Chat ID:
    * **For personal notifications:** Send a message to your new bot. Then, visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`. Look for the `chat` object and its `id`.
    * **For group notifications:** Add your bot to the desired Telegram group. Send a message in the group. Then, visit the `getUpdates` URL as above. The chat ID will be a negative number.

### 4. Cloudflare Worker Setup

#### A. Create the Worker

1.  Log in to your Cloudflare dashboard.
2.  Go to **Workers & Pages**.
3.  Click **"Create application"**, then **"Create Worker"**.
4.  Give your worker a name (e.g., `tailscale-monitor`).
5.  Deploy the initial worker (you'll upload your code next).

#### B. Set up KV Namespaces

You need two KV namespaces:

1.  **`TAILSCALE_NODE_STATUS_KV`**: Stores the last known status, alert timestamp, and first down timestamp for each monitored device.
2.  **`TAILSCALE_OAUTH_TOKEN_CACHE_KV`**: Caches the Tailscale API OAuth access token to reduce redundant API calls.

To create KV namespaces:

1.  In the Cloudflare dashboard, go to **Workers & Pages -> KV**.
2.  Click **"Create a namespace"**.
3.  Enter a name (e.g., `TAILSCALE_NODE_STATUS_KV`) and click "Add".
4.  Repeat for the second namespace (e.g., `TAILSCALE_OAUTH_TOKEN_CACHE_KV`).

#### C. Configure Environment Variables

In your Worker's settings (**Settings -> Variables -> Environment Variables -> Edit variables**):

| Variable Name                      | Description                                                                                                | Example Value                           | Required |
| :--------------------------------- | :--------------------------------------------------------------------------------------------------------- | :-------------------------------------- | :------- |
| `API_ACCESS_TOKEN_WORKER`          | Optional. A secret token to authenticate GET requests to the worker's `/` endpoint.                        | `your_secure_random_string`             | No       |
| `TELEGRAM_BOT_TOKEN`               | Your Telegram Bot API token from BotFather.                                                                | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123` | Yes      |
| `TELEGRAM_CHAT_ID`                 | The chat ID (user or group) where Telegram notifications will be sent.                                     | `123456789` or `-100123456789`          | Yes      |
| `TAILNET_NAME`                     | Your Tailscale tailnet name (e.g., `your-org.github`, `example.com`, or your account email for personal plans). | `your-tailnet.ts.net`                 | Yes      |
| `TAILSCALE_OAUTH_CLIENT_ID`        | The Client ID of your Tailscale OAuth client.                                                              | `oc_xxxxxxxxxxxxxx`                     | Yes      |
| `TAILSCALE_OAUTH_CLIENT_SECRET`    | The Client Secret of your Tailscale OAuth client. **Treat this like a password!** | `tskey-client-secret-xxxxxxxxxx`        | Yes      |
| `TAILSCALE_NODE_STATUS_KV`         | **Binding Name:** The KV Namespace for storing node statuses. (See D)                                      | `MY_NODE_STATUS_KV` (binding name)      | Yes      |
| `TAILSCALE_OAUTH_TOKEN_CACHE_KV`   | **Binding Name:** The KV Namespace for caching Tailscale OAuth tokens. (See D)                             | `MY_TOKEN_CACHE_KV` (binding name)      | Yes      |
| `DOWN_THRESHOLD_MINUTES`           | Minutes since a device was last seen to consider it OFFLINE.                                               | `15`                                    | Yes      |
| `REMINDER_INTERVAL_MINUTES`        | Minutes after which a reminder is sent if a device is still OFFLINE.                                       | `240` (4 hours)                         | Yes      |
| `MONITOR_TAGS`                     | Comma-separated list of Tailscale tags. Only devices with at least one of these tags will be monitored. If empty, all devices are monitored. | `tag:server,tag:critical`              | No       |
| `TOKEN_KV_KEY`                     | The key used to store the OAuth token in `TAILSCALE_OAUTH_TOKEN_CACHE_KV`.                                 | `tailscale_oauth_token`                 | Yes      |
| `TOKEN_EXPIRY_BUFFER_SECONDS`      | Buffer (in seconds) before the actual token expiry to refresh it.                                          | `300` (5 minutes)                       | Yes      |

**Important:** For `TAILSCALE_NODE_STATUS_KV` and `TAILSCALE_OAUTH_TOKEN_CACHE_KV`, you first add them as "KV Namespace Bindings" under your worker's settings. The "Variable name" you choose here is what you use as the value for the environment variable (this name is also what `env.VARIABLE_NAME` in your code will refer to).

#### D. Add KV Namespace Bindings

1.  Go to your Worker's settings (**Settings -> Variables**).
2.  Scroll down to **KV Namespace Bindings**.
3.  Click **"Add binding"**.
    * **Variable name:** `TAILSCALE_NODE_STATUS_KV` (this is what `env.TAILSCALE_NODE_STATUS_KV` in `config.js` refers to)
    * **KV namespace:** Select the KV namespace you created for node statuses.
4.  Click **"Add binding"** again.
    * **Variable name:** `TAILSCALE_OAUTH_TOKEN_CACHE_KV`
    * **KV namespace:** Select the KV namespace you created for token caching.
5.  Click "Save".

#### E. Configure Wrangler (wrangler.toml)

If you are using `wrangler` CLI for deployment, your `wrangler.toml` file should look something like this. Pay close attention to the `kv_namespaces` bindings.

```toml
name = "tailscale-monitor" # Or whatever you named your worker
main = "index.js"         # Or your main entry point file
compatibility_date = "2025-05-15" # Use a recent date like your deployment date or current date

# KV Namespace bindings
# The 'binding' name here MUST match what you use in your code (e.g., env.TAILSCALE_NODE_STATUS_KV)
# The 'id' is the ID of the KV namespace you created in the Cloudflare dashboard.
kv_namespaces = [
  { binding = "TAILSCALE_NODE_STATUS_KV", id = "<your_node_status_kv_namespace_id>" },
  { binding = "TAILSCALE_OAUTH_TOKEN_CACHE_KV", id = "<your_oauth_token_cache_kv_namespace_id>" }
]

# [vars] block for non-secret environment variables
[vars]
DOWN_THRESHOLD_MINUTES = "15"
REMINDER_INTERVAL_MINUTES = "240"
# TAILNET_NAME = "your-tailnet.ts.net" # Set this as a secret or here if not sensitive
MONITOR_TAGS = "tag:server,tag:production" # Example, adjust as needed or leave empty
TOKEN_KV_KEY = "tailscale_oauth_token"
TOKEN_EXPIRY_BUFFER_SECONDS = "300"

# Note: Secrets like TELEGRAM_BOT_TOKEN, TAILSCALE_OAUTH_CLIENT_ID, TAILSCALE_OAUTH_CLIENT_SECRET, TAILNET_NAME (recommended),
# and API_ACCESS_TOKEN_WORKER (if used) should be set using 'wrangler secret put VARIABLE_NAME'
# or directly in the Cloudflare dashboard under Worker Settings -> Variables -> Environment Variables.
# They should not be committed to your wrangler.toml if it's public.
```

You can find the KV Namespace IDs in the Cloudflare Dashboard under **Workers & Pages -> KV**. Select your namespace, and the ID will be displayed. *Make sure to update the `compatibility_date` in your `wrangler.toml` to a recent date or the date you are deploying (e.g., `2025-05-15` based on current date).*

#### F. Set up Scheduled Triggers (Cron)

1.  Go to your Worker's settings.
2.  Select the **Triggers** tab.
3.  Under **Cron Triggers**, click **"Add Cron Trigger"**.
4.  Enter a cron expression. For example, to run every 5 minutes: `*/5 * * * *`.
5.  Click **"Add"**.

    *Common Cron Examples:*
    * `*/5 * * * *` - Every 5 minutes
    * `*/15 * * * *` - Every 15 minutes
    * `0 * * * *` - Every hour at the start of the hour

#### G. Deploy the Code

* **Via Cloudflare Dashboard (Quick Edit for simple, single-file setups or basic module support):**
    1.  Go to your Worker.
    2.  Click **"Quick Edit"**.
    3.  Cloudflare Workers support ES modules. You can create/upload your `.js` files (`index.js`, `config.js`, etc.) directly if your Worker is configured for multi-script format. Ensure `index.js` correctly imports other modules using relative paths (e.g., `./config.js`).
    4.  Ensure your `index.js` is the main entry point.
    5.  Click **"Save and Deploy"**.
* **Via Wrangler CLI (Recommended for module-based projects):**
    1.  Ensure you have Node.js and npm installed.
    2.  Install Wrangler: `npm install -g wrangler`
    3.  Log in to Wrangler: `wrangler login`
    4.  Navigate to your project directory in the terminal (where your `.js` files and `wrangler.toml` are).
    5.  Set secrets (these will be encrypted and stored by Cloudflare):
        ```bash
        wrangler secret put TELEGRAM_BOT_TOKEN
        wrangler secret put TELEGRAM_CHAT_ID
        wrangler secret put TAILSCALE_OAUTH_CLIENT_ID
        wrangler secret put TAILSCALE_OAUTH_CLIENT_SECRET
        wrangler secret put TAILNET_NAME # Recommended to set as secret
        # Add API_ACCESS_TOKEN_WORKER if you use it
        # wrangler secret put API_ACCESS_TOKEN_WORKER
        ```
        Wrangler will prompt you to enter the value for each secret.
    6.  Non-secret environment variables can be set in the `[vars]` section of `wrangler.toml` or via the dashboard.
    7.  Deploy: `wrangler deploy` (ensure your `main` in `wrangler.toml` points to `index.js`).

### Usage

#### Monitoring

Once deployed and configured with a cron trigger, the worker will automatically run at the specified intervals. It will:

* Check the status of your Tailscale devices.
* Send Telegram notifications for any changes or required reminders.
* Log its activities, which you can view in your Worker's logs in the Cloudflare dashboard.

#### Fetching Status via API (Optional)

If you have configured `API_ACCESS_TOKEN_WORKER`, you can retrieve the current status of all monitored devices by making a GET request to your worker's URL.

* **URL:** `https://<your-worker-name>.<your-account-subdomain>.workers.dev/`
* **Method:** `GET`
* **Headers:**
    * `X-Auth-Token: <your_API_ACCESS_TOKEN_WORKER_value>` (Required if `API_ACCESS_TOKEN_WORKER` is set)


**Example Response:**

```json
{
  "success": true,
  "data": [
    {
      "nodeId": "1234567890abcdef",
      "shortName": "my-server",
      "status": {
        "state": "OFFLINE",
        "alertTs": "2023-10-27T10:30:00.000Z",
        "firstDownTs": "2023-10-27T08:15:00.000Z"
      }
    },
    {
      "nodeId": "fedcba0987654321",
      "shortName": "my-laptop",
      "status": {
        "state": "ONLINE",
        "alertTs": null,
        "firstDownTs": null
      }
    }
    // ... more nodes
  ]
}
```


## License

Distributed under the MIT License. See `LICENSE` for more information.
