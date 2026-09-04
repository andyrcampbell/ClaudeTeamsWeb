// Offline license-key verification. A key is a signed, self-contained token
// issued by the website's Stripe fulfillment webhook — the app never needs
// to phone home to check it. See scripts/license/keygen.js for how the
// keypair was made, and the licensing-website-integration/ package (outside
// this repo) for how keys get issued.
//
// Key shape:  ACS1.<payload-b64url>.<sig-b64url>
//   payload = base64url(JSON.stringify({ email, id, iat }))
//   sig     = Ed25519 signature over the UTF-8 bytes of the payload's
//             base64url text (not the decoded JSON) — mirrors how a JWT
//             signs its encoded segments rather than raw claims.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Public half of the keypair from scripts/license/keygen.js. Safe to ship —
// it can only verify signatures, never produce them.
const PUBLIC_KEY_X = "5odTxY6RD03H_jgSlLK3T4wpQBPvUTlT-XfjABlPVVQ";

const TRIAL_DAYS = 7;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

function publicKeyObject() {
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: PUBLIC_KEY_X },
    format: "jwk",
  });
}

// Returns { valid: true, email, id, iat } or { valid: false, reason }.
function verifyLicenseKey(rawKey) {
  const key = String(rawKey || "").trim();
  const parts = key.split(".");
  if (parts.length !== 3 || parts[0] !== "ACS1") {
    return { valid: false, reason: "That doesn't look like a license key." };
  }
  const [, payloadB64, sigB64] = parts;

  let signature;
  try {
    signature = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false, reason: "Malformed license key." };
  }

  let verified;
  try {
    verified = crypto.verify(null, Buffer.from(payloadB64, "utf8"), publicKeyObject(), signature);
  } catch {
    return { valid: false, reason: "Malformed license key." };
  }
  if (!verified) {
    return { valid: false, reason: "This license key is not valid." };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "Malformed license key." };
  }
  if (!payload || typeof payload.email !== "string" || typeof payload.id !== "string") {
    return { valid: false, reason: "Malformed license key." };
  }

  return { valid: true, email: payload.email, id: payload.id, iat: payload.iat };
}

function licenseFile(dataDir) {
  return path.join(dataDir, "license.json");
}

// Returns the verified payload of the currently stored license, or null if
// there isn't one / it no longer verifies (e.g. the file was hand-edited).
function loadStoredLicense(dataDir) {
  try {
    const { key } = JSON.parse(fs.readFileSync(licenseFile(dataDir), "utf8"));
    const result = verifyLicenseKey(key);
    return result.valid ? result : null;
  } catch {
    return null;
  }
}

function saveLicense(dataDir, key) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(licenseFile(dataDir), JSON.stringify({ key, savedAt: Date.now() }, null, 2));
}

function trialFile(dataDir) {
  return path.join(dataDir, "trial.json");
}

// Returns { startedAt, daysLeft, expired } if a trial has ever been started
// on this machine, or null otherwise. Purely local — there's no server
// enforcing this, so it's resettable by deleting trial.json or moving the
// system clock back. Fine for a v1 trial; not a real anti-piracy measure.
function loadTrialState(dataDir) {
  try {
    const { startedAt } = JSON.parse(fs.readFileSync(trialFile(dataDir), "utf8"));
    const elapsedMs = Date.now() - startedAt;
    const daysLeft = Math.max(0, Math.ceil((TRIAL_MS - elapsedMs) / (24 * 60 * 60 * 1000)));
    return { startedAt, daysLeft, expired: elapsedMs >= TRIAL_MS };
  } catch {
    return null;
  }
}

function startTrial(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(trialFile(dataDir), JSON.stringify({ startedAt: Date.now() }, null, 2));
  return loadTrialState(dataDir);
}

module.exports = {
  verifyLicenseKey,
  loadStoredLicense,
  saveLicense,
  loadTrialState,
  startTrial,
  TRIAL_DAYS,
};
