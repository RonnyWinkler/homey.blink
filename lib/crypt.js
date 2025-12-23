
// PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0

const crypto = require('crypto');

/**
 * Generate PKCE code_verifier and code_challenge.
 *
 * @returns {Object} An object with code_verifier and code_challenge
 *
 * Example:
 *   const { code_verifier, code_challenge } = generatePkcePair();
 *   console.log(code_verifier.length >= 43); // true
 */
function generatePkcePair() {
  // Generate code_verifier (43-128 characters, URL-safe base64)
  const code_verifier = base64UrlEncode(crypto.randomBytes(32));

  // Generate code_challenge (SHA256 hash of verifier, URL-safe base64)
  const hash = crypto.createHash('sha256').update(code_verifier).digest();
  const code_challenge = base64UrlEncode(hash);

  return { code_verifier, code_challenge };
}

/**
 * Convert a Buffer to URL-safe Base64 string (RFC 7636)
 * Removes padding '=' and replaces '+' with '-' and '/' with '_'
 */
function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

module.exports = { generatePkcePair };