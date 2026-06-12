export enum ErrorCode {
  ParamsError = 40000,
  OperationError = 50001,
}

export class CliError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}
