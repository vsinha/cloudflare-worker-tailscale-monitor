/**
 * Escapes special characters in a string for use in Telegram MarkdownV2.
 *
 * MarkdownV2 requires certain characters like '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
 * to be escaped with a preceding backslash ('\') to be displayed as literal characters.
 * If the input is not a string, it will be converted to a string before processing.
 *
 * @param {string | any} text The text to escape.
 * @returns {string} The escaped text, safe for use in MarkdownV2.
 */
export function escapeMarkdownV2(text) {
  if (typeof text !== "string") return String(text);
  const charsToEscape = /[_*[\]()~`>#+\-=|{}.!]/g;
  return text.replace(charsToEscape, "\\$&");
}

/**
 * Sends a notification message to a specified Telegram chat using a bot.
 *
 * This asynchronous function takes a message text, a Telegram bot token, and a chat ID.
 * It constructs a request to the Telegram Bot API to send the message,
 * formatted with MarkdownV2. It handles potential errors during the API call
 * and logs information to the console.
 *
 * @async
 * @param {string} messageText The text of the message to send. Special MarkdownV2 characters should be escaped using `escapeMarkdownV2` before passing to this function.
 * @param {string} botToken The authentication token for the Telegram bot.
 * @param {string | number} chatId The unique identifier for the target chat (user, group, or channel).
 * @returns {Promise<{success: boolean, error?: string}>} A promise that resolves to an object.
 * The object has a `success` property (boolean) indicating whether the message was sent successfully.
 * If `success` is false, an `error` property (string) will contain a description of the error.
 */
export async function sendTelegramNotification(messageText, botToken, chatId) {
  if (!botToken || !chatId) {
    console.warn(
      "Telegram Bot Token or Chat ID is missing. Cannot send notification."
    );
    return {
      success: false,
      error: "Telegram secrets not provided to function",
    };
  }

  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const telegramPayload = {
    chat_id: chatId,
    text: messageText,
    parse_mode: "MarkdownV2",
  };

  try {
    console.log(`Sending Telegram notification (Chat ID: ${chatId})...`);
    const response = await fetch(telegramApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(telegramPayload),
    });

    const responseData = await response.json();

    if (!responseData.ok) {
      console.error(
        `Telegram API error: ${
          responseData.description || JSON.stringify(responseData)
        }`
      );
      return {
        success: false,
        error: `Telegram API Error: ${
          responseData.description || responseData.error_code
        }`,
      };
    } else {
      console.log("Telegram notification sent successfully.");
      return { success: true };
    }
  } catch (fetchErr) {
    console.error(
      "Failed to send Telegram notification (fetch request error):",
      fetchErr.message
    );
    return { success: false, error: `Workspace Error: ${fetchErr.message}` };
  }
}
