// 公開例外の種類・reasonで原因を区別し、messageの文字列解析に依存させない。
// pathは入力・設定項目、または導出値の場所（UNSAFE_POSTERIOR）を示す。
// HTTPのstatus・response code・応答形式はここでは定めない。
type FieldPath = readonly (string | number)[];
type InputReason = 'INVALID_LOCAL_DATE' | 'FUTURE_LOG_DATE' | 'DUPLICATE_LOG_DATE' |
  'INVALID_QUANTITY' | 'INVALID_LOG_STATUS' | 'INVALID_LOG_AMOUNT' | 'UNSAFE_PROGRESS';
type ConfigReason = 'INVALID_INTEGER' | 'INVALID_SEED' | 'UNSUPPORTED_MODEL' | 'UNSAFE_POSTERIOR' |
  'UNSUPPORTED_METHOD' | 'RESOURCE_LIMIT';

export class PredictionInputError extends RangeError {
  readonly reason: InputReason;
  readonly path: FieldPath;

  constructor(reason: InputReason, path: FieldPath, message: string) {
    super(message);
    this.name = 'PredictionInputError';
    this.reason = reason;
    this.path = Object.freeze([...path]);
  }
}

export class PredictionConfigError extends RangeError {
  readonly reason: ConfigReason;
  readonly path: FieldPath;

  constructor(reason: ConfigReason, path: FieldPath, message: string) {
    super(message);
    this.name = 'PredictionConfigError';
    this.reason = reason;
    this.path = Object.freeze([...path]);
  }
}
