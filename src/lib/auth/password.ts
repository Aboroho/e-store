import bcrypt from "bcryptjs";

/**
 * Password hashing and policy.
 *
 * bcrypt is used with a cost factor of 12; the hash includes the salt so no
 * separate salt column is required.
 */

const BCRYPT_ROUNDS = 12;

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordPolicyResult {
  valid: boolean;
  problems: string[];
}

/**
 * Password policy: at least 10 characters and at least three of the four
 * character classes. Deliberately avoids forced rotation and complexity
 * theatre beyond that.
 */
export function evaluatePasswordPolicy(password: string, context: { email?: string; name?: string } = {}): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) {
    problems.push("Mix upper case, lower case, numbers and symbols (at least three of the four).");
  }
  const lowered = password.toLowerCase();
  // Compare against the individual tokens of the email local part and the name
  // ("rahman.khan@example.com" -> ["rahman", "khan"]) so that separators such as
  // dots, dashes or spaces cannot be used to smuggle an identity into the password.
  const identityTokens = new Set<string>();
  if (context.email) {
    const localPart = context.email.split("@")[0] ?? "";
    for (const token of localPart.split(/[^a-z0-9]+/i)) {
      if (token.length >= 3) identityTokens.add(token.toLowerCase());
    }
  }
  if (context.name) {
    for (const token of context.name.split(/[^\p{L}0-9]+/u)) {
      if (token.length >= 3) identityTokens.add(token.toLowerCase());
    }
  }
  if (identityTokens.size > 0) {
    const collapsed = lowered.replace(/[^a-z0-9]+/g, "");
    for (const token of identityTokens) {
      if (lowered.includes(token) || collapsed.includes(token)) {
        problems.push("Password must not contain your name or email address.");
        break;
      }
    }
  }
  const common = ["password", "123456", "qwerty", "admin", "letmein", "welcome"];
  if (common.some((entry) => lowered.includes(entry))) {
    problems.push("Password is too common.");
  }
  return { valid: problems.length === 0, problems };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** A dummy hash used to equalise timing when an account does not exist. */
export const DUMMY_PASSWORD_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeOq4bq0QfJ0m3i1sI6uKXzZ1eZ0yGm9xO";
