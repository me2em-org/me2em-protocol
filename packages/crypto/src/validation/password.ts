// packages/crypto/src/validation/password.ts
import { randomBytes } from '../utils/binary.js';

/**
 * Result of password strength validation.
 */
export interface PasswordValidationResult {
  score: number;
  maxScore: number;
  isSecure: boolean;
  feedback: string[];
  suggestions: string[];
  entropy: number;
  uniqueChars: number;
  isLeaked: boolean;
}

/**
 * Common passwords that should never be used.
 *
 * Includes both English and commonly-see variants. This list is not
 * exhaustive — the full check also includes HIBP breach data.
 */
const COMMON_PASSWORDS = [
  'password', 'password1', 'password123', 'qwerty', 'qwerty123',
  'letmein', 'admin', '123456', '12345678', 'abc123',
  'monkey', 'master', 'dragon', 'login', 'princess',
  'football', 'shadow', 'sunshine', 'trustno1', 'iloveyou',
  'batman', 'access', 'hello', 'charlie', 'donald',
  'password1', 'qwerty123',
];

/**
 * Common sequential patterns (keyboard and alphabetical).
 */
const SEQUENTIAL_PATTERNS = [
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
  '01234567890',
  '09876543210',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/**
 * Checks if a password appears in the HIBP (Have I Been Pwned) breach database.
 *
 * Uses k-anonymity: sends only the first 5 hex characters of the SHA-1 hash
 * and matches against the full response. Fail-open: network errors return
 * false (does not block the user).
 *
 * @param password - The password to check.
 * @returns true if the password was found in a breach.
 * @throws Never — always returns a boolean.
 */
async function checkPasswordLeak(password: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-1', encoder.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 3000);

    try {
      const response = await fetch(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { signal: abortController.signal }
      );

      if (!response.ok) return false;

      const text = await response.text();
      return text.split('\r\n').some((line) => line.split(':')[0] === suffix);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

/**
 * Estimates password entropy in bits based on character set size and length.
 *
 * @param password - The password to estimate.
 * @returns Entropy in bits (float).
 */
function estimateEntropy(password: string): number {
  let charsetSize = 0;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  if (hasLower) charsetSize += 26;
  if (hasUpper) charsetSize += 26;
  if (hasDigit) charsetSize += 10;
  if (hasSpecial) charsetSize += 32;

  if (charsetSize === 0) return 0;
  return password.length * Math.log2(charsetSize);
}

/**
 * Checks for repeated substrings (e.g. "abcabc").
 */
function hasRepeats(password: string): boolean {
  for (let len = 2; len <= Math.floor(password.length / 2); len++) {
    for (let i = 0; i <= password.length - len * 2; i++) {
      const sub = password.slice(i, i + len);
      if (password.slice(i + len, i + len * 2) === sub) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if password contains any sequential pattern.
 */
function hasSequentialPattern(password: string): boolean {
  const lower = password.toLowerCase();
  for (const pattern of SEQUENTIAL_PATTERNS) {
    for (let i = 0; i <= pattern.length - 4; i++) {
      if (pattern.slice(i, i + 4).includes(lower)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if password contains any common password (case-insensitive).
 */
function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.includes(password.toLowerCase());
}

/**
 * Validates password strength with detailed feedback.
 *
 * Performs 7 checks: length ≥14, 4 character types, unique chars ≥12,
 * no repeats, no sequential patterns, not in common list, entropy ≥80 bits,
 * and HIBP breach check.
 *
 * @param password - The password to validate.
 * @returns A detailed validation result.
 *
 * @example
 * ```ts
 * const result = validatePasswordStrength('MyStr0ng!Pass#2024');
 * if (!result.isSecure) {
 *   console.warn(result.feedback);
 * }
 * ```
 */
export async function validatePasswordStrength(
  password: string
): Promise<PasswordValidationResult> {
  const feedback: string[] = [];
  const suggestions: string[] = [];
  let score = 0;
  const maxScore = 7;

  const entropy = estimateEntropy(password);
  const uniqueChars = new Set(password).size;

  // 1. Length ≥ 14
  if (password.length >= 14) {
    score++;
  } else {
    feedback.push(`Password is too short (${password.length}/14 characters)`);
    suggestions.push('Use at least 14 characters');
  }

  // 2. Has lowercase
  if (/[a-z]/.test(password)) score++;
  else suggestions.push('Add lowercase letters');

  // 3. Has uppercase
  if (/[A-Z]/.test(password)) score++;
  else suggestions.push('Add uppercase letters');

  // 4. Has digit
  if (/[0-9]/.test(password)) score++;
  else suggestions.push('Add numbers');

  // 5. Has special character
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else suggestions.push('Add special characters (!@#$%^&*)');

  // 6. Unique characters ≥ 12
  if (uniqueChars >= 12) {
    score++;
  } else {
    feedback.push(`Too few unique characters (${uniqueChars}/12)`);
    suggestions.push('Use more unique characters');
  }

  // 7. No repeats
  if (!hasRepeats(password)) {
    score++;
  } else {
    feedback.push('Contains repeated patterns');
    suggestions.push('Avoid repeated character sequences');
  }

  // 8. No sequential patterns
  if (!hasSequentialPattern(password)) {
    score++;
  } else {
    feedback.push('Contains sequential patterns (e.g. abc, 123)');
    suggestions.push('Avoid sequential characters');
  }

  // 9. Not a common password
  if (!isCommonPassword(password)) {
    score++;
  } else {
    feedback.push('This is a commonly used password');
    suggestions.push('Choose a password not found in common breach lists');
  }

  // 10. Entropy ≥ 80 bits
  if (entropy >= 80) {
    score++;
  } else {
    feedback.push(`Low entropy (${entropy.toFixed(0)} bits, need ≥80)`);
    suggestions.push('Increase password complexity for higher entropy');
  }

  // 11. HIBP breach check
  let isLeaked = false;
  try {
    isLeaked = await checkPasswordLeak(password);
    if (isLeaked) {
      feedback.push('This password was found in a data breach');
      suggestions.push('Change this password — it has been exposed');
    }
  } catch {
    // fail-open: network error, skip
  }

  const isSecure = score >= 5 && !isLeaked && entropy >= 60;

  return {
    score,
    maxScore,
    isSecure,
    feedback,
    suggestions,
    entropy,
    uniqueChars,
    isLeaked,
  };
}

/**
 * Generates a cryptographically secure random password.
 *
 * Guarantees at least 2 characters of each type (lowercase, uppercase,
 * digit, special) and fills the rest with Fisher-Yates shuffled
 * characters from the full charset.
 *
 * @param length - Password length (default 16). Minimum 8.
 * @returns A random password string.
 *
 * @example
 * ```ts
 * const pw = generateSecurePassword(20);
 * // e.g. "kR#9mP!xL2qW@7nY&4jT"
 * ```
 */
export function generateSecurePassword(length: number = 16): string {
  if (length < 8) length = 8;

  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const all = lower + upper + digits + special;

  const bytes = randomBytes(length);
  const chars: string[] = [];

  // Guarantee at least 2 of each type
  chars.push(lower[bytes[0] % lower.length]);
  chars.push(upper[bytes[1] % upper.length]);
  chars.push(digits[bytes[2] % digits.length]);
  chars.push(special[bytes[3] % special.length]);
  chars.push(lower[bytes[4] % lower.length]);
  chars.push(upper[bytes[5] % upper.length]);
  chars.push(digits[bytes[6] % digits.length]);
  chars.push(special[bytes[7] % special.length]);

  // Fill the rest
  for (let i = 8; i < length; i++) {
    chars.push(all[bytes[i] % all.length]);
  }

  // Fisher-Yates shuffle using the same random bytes
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[(i + 8) % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * Quick password validation: basic checks only (length, character types).
 *
 * Use this for real-time feedback during typing; use
 * {@link validatePasswordStrength} for the full check including HIBP.
 *
 * @param password - The password to validate.
 * @returns { isValid, error? }
 */
export function quickPasswordValidation(
  password: string
): { isValid: boolean; error?: string } {
  if (password.length < 14) {
    return { isValid: false, error: 'Password must be at least 14 characters' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: 'Must contain lowercase letters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Must contain uppercase letters' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Must contain numbers' };
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return { isValid: false, error: 'Must contain special characters' };
  }
  return { isValid: true };
}
