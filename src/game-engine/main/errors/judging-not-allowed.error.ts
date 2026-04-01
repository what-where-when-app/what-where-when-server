export class JudgingNotAllowedError extends Error { // will rewrite error logic within snackbar feature
  readonly code = 'JUDGING_NOT_ALLOWED_WHILE_QUESTION_ACTIVE';

  constructor() {
    super(
      'Cannot judge answers while this question is in THINKING or ANSWERING phase',
    );
    this.name = 'JudgingNotAllowedError';
  }
}
