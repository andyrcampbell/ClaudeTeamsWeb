// One-off: generates the Ed25519 keypair used for offline license-key
// verification. Run with `node scripts/license/keygen.js`.
//
// The PUBLIC key's x-coordinate goes into electron/license.js (safe to
// commit — it can only verify signatures, not create them).
// The PRIVATE key's d-value goes into the website's LICENSE_SIGNING_PRIVATE_KEY
// env var (Vercel) ONLY. Never commit it, never put it in this repo.

const crypto = require("crypto");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

console.log("Public key x  (embed in electron/license.js):");
console.log(pub.x);
console.log();
console.log("Private key d (Vercel env var LICENSE_SIGNING_PRIVATE_KEY only):");
console.log(priv.d);
