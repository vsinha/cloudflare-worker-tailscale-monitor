/**
 * Checks if all required environment variable keys are present in the provided env object.
 * Throws an error if any required key is missing or falsy (treats empty strings as missing).
 *
 * @param {object} env - The environment object containing secrets and bindings.
 * @param {string[]} requiredKeys - An array of keys that must be present in env.
 * @throws {Error} If a required key is missing or if inputs are invalid.
 */
export function ensureRequiredEnv(env, requiredKeys) {
  if (!Array.isArray(requiredKeys)) {
    throw new Error("Internal Error: requiredKeys must be an array.");
  }
  if (typeof env !== "object" || env === null) {
    throw new Error("Internal Error: env object is missing or invalid.");
  }

  const missingKeys = [];
  for (const key of requiredKeys) {
    if (!env[key]) {
      // Covers undefined, null, empty string, 0, false
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `Configuration Error: Missing required environment variable(s): ${missingKeys.join(
        ", "
      )}`
    );
  }

  console.log(
    "All required environment variables checked appear to be present."
  );
}
