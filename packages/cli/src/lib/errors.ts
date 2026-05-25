/**
 * Errors thrown by helpcode itself.
 *
 * Use HelpcodeError, never plain Error, for any user-facing failure.
 * The CLI's top-level handler reads `.hint` and shows it to the user.
 */

export enum ErrorCode {
  /** State or config file missing/malformed. */
  STATE_ERROR = 'STATE_ERROR',
  /** Reading or writing a file failed. */
  IO_ERROR = 'IO_ERROR',
  /** Input failed validation (parser, patcher, etc.). */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** A subprocess (tests, git, etc.) failed in a way we report up. */
  SUBPROCESS_ERROR = 'SUBPROCESS_ERROR',
  /** User cancelled or provided no input where required. */
  USER_CANCELLED = 'USER_CANCELLED',
  /** A feature isn't implemented yet on this path. */
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export class HelpcodeError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;

  constructor(code: ErrorCode, message: string, hint = '') {
    super(message);
    this.name = 'HelpcodeError';
    this.code = code;
    this.hint = hint;
  }
}
