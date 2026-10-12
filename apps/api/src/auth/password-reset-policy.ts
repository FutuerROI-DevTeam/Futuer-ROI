// #284: メール配送の受入まで一時停止。UI/API/メール設定が同じ値を使う。
// 環境変数では再開できない。再開にはコードレビューと配送・旧リンクの扱いの確認が必要。
export const PASSWORD_RESET_ENABLED: boolean = false;
export const PASSWORD_RESET_UNAVAILABLE_MESSAGE = '現在パスワード再設定は利用できません';
