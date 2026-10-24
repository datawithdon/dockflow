// Calls the Claude Messages API straight from the browser with the user's own
// API key. There is no server in between: the key and the document go only to
// api.anthropic.com (the page's Content-Security-Policy blocks every other
// destination). Raw fetch is used because the app has no build step to bundle
// the SDK.

import { buildRequest, parseResponse } from "./engine/extract.js";
import { getApiKey, state } from "./state.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export async function readDocument(file, expectedType) {
  const key = getApiKey();
  if (!key) throw new Error("Add your Claude API key in Settings → AI first.");
  const { body, betas } = buildRequest(file, expectedType, state.settings.model);
  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    // Required for browser calls; the key belongs to this user and is used
    // only from their own browser.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (betas.length) headers["anthropic-beta"] = betas.join(",");

  let res;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), referrerPolicy: "no-referrer", credentials: "omit" });
  } catch {
    throw new Error("Could not reach the Claude API. Check your connection.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new Error(apiError(res.status, data));
  return parseResponse(data);
}

function apiError(status, data) {
  const msg = typeof data?.error?.message === "string" ? data.error.message.slice(0, 200) : "";
  switch (status) {
    case 401: return "The API key was rejected. Check it in Settings → AI.";
    case 403: return "This API key is not allowed to use that model.";
    case 413: return "The file is too large for the API. Try a smaller scan or fewer pages.";
    case 429: return "Rate limited by the API. Wait a moment and try again.";
    case 529: return "The API is overloaded right now. Try again shortly.";
    default: return `API error ${status}${msg ? `: ${msg}` : ""}`;
  }
}
