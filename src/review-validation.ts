export type ReviewIssue = { path: string; message: string };

/** Actionable feedback, without persisting the model's untrusted submission. */
export class ReviewValidationError extends Error {
  readonly issues: ReviewIssue[];
  readonly retryable:boolean;
  constructor(issues: ReviewIssue[], retryable=true) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
    this.name = 'ReviewValidationError';
    this.issues = issues;
    this.retryable=retryable;
  }
}
