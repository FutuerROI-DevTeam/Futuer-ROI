import type { MailConfig } from '../config.ts';
import { createLogMailer, createResendMailer, type Mailer } from './mailer.ts';

// 設定から送信手段を選ぶ。server（常駐）とvercel（Function）の2つの起動境界で同じ選び方にする。
export function createMailer(config: MailConfig): Mailer {
  // 停止中はlog/resendのどちらも作らず、誤呼出しでも秘密のURLを出力しない。
  if (config.transport === 'disabled') return async () => { throw new Error('Password reset is unavailable.'); };
  return config.transport === 'resend' ? createResendMailer({ apiKey: config.apiKey, from: config.from }) : createLogMailer();
}
