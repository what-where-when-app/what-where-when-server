export class GameNotStartableError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GameNotStartableError';
    this.code = code;
  }
}
