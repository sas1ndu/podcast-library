/* PUBLIC site configuration. Loaded before app.js. No build step required.
 * This is not a secret store: visitors can read every value in this file.
 * Do not add Cloudflare API tokens, R2 access keys, or AI provider secrets.
 */
window.PODCAST_CONFIG = Object.freeze({
  appName: "Audio Library",
  apiBaseUrl: "https://podcast-api.pradeepsasindu2001.workers.dev",
  maxUploadBytes: 80 * 1024 * 1024,
  uploadTimeoutMs: 20 * 60 * 1000,
  defaultSubjects: [
    { id: "accounting", name: "Accounting", color: "#5e4ce6" },
    { id: "tax", name: "Tax", color: "#bd4e6d" },
    { id: "risk", name: "Risk", color: "#ad741c" },
    { id: "it", name: "IT", color: "#278166" }
  ]
});
