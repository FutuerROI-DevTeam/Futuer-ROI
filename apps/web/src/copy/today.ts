// Today Decision 画面の文言。Product Spec「Today Decision画面の表示仕様」の固定文言をここに集める。
// 文言を変えるときは、このファイルだけを直す（仕様の文言を変える場合は P-12 の改訂として記録する）。

export const todayCopy = {
  question: '今日サボると、ゴールは何日遠ざかる？',
  coreLabel: 'ゴールが遠ざかる日数（目安）',
  /** 中心指標の注釈（Product Spec の固定文言）。 */
  coreNote:
    'あなたの記録から推定した「休んだ後の再開傾向」をもとに計算しています。今日休んだ場合、次に再開するまでの日数の中央値です。同じ継続傾向と設定量で続け、再開後に同じ道をたどるモデルでは、完了が遅れる日数の中央値とも解釈できます。完了日の中央値どうしの差や、実際の因果効果を表すものではなく、将来を保証するものではありません。',
  /** 中心の数字のすぐ下に出す要約1行（デザイン案B）。全文は「遅れの目安の根拠」に置く。 */
  coreSummary: 'あなたの記録から推定した目安です。将来を保証するものではありません。',
  whyTitle: '遅れの目安の根拠',
  completionWhyTitle: '完了予測の根拠',
  progressDetailsTitle: '記録の推移を見る',
  todayRecordTitle: '今日の記録',
  recordTarget: '記録する日',
  completionLabelTodayDone: (session: string) => `設定量（${session}）で続ける場合`,
  completionTodayAssumption: (session: string) => `今日は設定量（${session}）を行い、今後も同じ量ずつ行う想定です。`,
  completionAssumption: (session: string) => `今後も設定量（${session}）ずつ行う想定です。`,
  amountPredictionNote: (session: string) => `予測は設定量${session}をもとに表示しています。`,
  progressGoal: '目標量',
  progressRemaining: '残り',
  progressExcess: '目標を超えた量',
  progressActual: (amount: string) => `累計 ${amount}`,
  completionLabelCurrent: (session: string) => `設定量（${session}）で続ける場合`,
  completionP50: (week: string) => `${week}ごろ`,
  completionBrief: (week: string) => `完了目安（設定量）：${week}ごろ`,
  completionBriefUnavailable: '完了目安：まだ算出できません',
  completionBriefOutside: '完了目安：約3年以内の目安なし',
  completionP80: (week: string) => `10回中8回は${week}まで`,
  completionP80Over3Years: '10回中8回の完了時期の目安は、計算範囲の約3年以内には収まりません。',
  /** 補助指標2の注釈（Product Spec の固定文言）。 */
  completionNote: '完了の目安は、同じ記録から推定した継続傾向をもとに計算した見込みです。',
  axisNote: '日付は、その週の月曜日で表しています。',
  insufficientCore: 'まだ「休んだ翌日」の記録がありません。記録がたまると、あなたの再開傾向から推定します。',
  insufficientCompletion: '「やった翌日」と「休んだ翌日」の記録がそれぞれたまると、完了の目安を表示します。',
  over3Years: '約3年以内の目安なし',
  // 見通しの補足（デザインキャンバス D4・D4b・D8）
  over3YearsNote: '約3年の計算範囲内で、完了する見込みが50%（半分）に届かないためです。材料不足や、将来も完了できないという意味ではありません。',
  p80Over3YearsNote: '約3年の計算範囲内で、完了する見込みが80%に届かないためです。材料不足や、将来も完了できないという意味ではありません。',
  thisWeekNote: '今日やれば、この週に届く見込みです。',
  progressLabel: 'これまでの積み上げ',
  /** initial は記録開始日の前日までの量を単位付きで書いたもの（例「20時間40分」）。0 なら null。 */
  progressHelp: (initial: string | null) => (initial ? `記録した累計（記録開始日の前日までの${initial}を含む）` : '記録した累計'),
  outlookLabel: 'これからの見通し',
  // 到達予定日（#157、B案）
  targetDate: '到達予定日',
  targetDateAxis: (date: string) => `到達予定日 ${date}`,
  /** 到達予定日が大きく先で、軸を途中で省いたときの読み上げ（#187）。 */
  targetDateAxisCut: '到達予定日は大きく先のため、軸を途中で省いて右端に示します。',
  targetGapPrefix: '到達予定日より',
  targetGapNote: '到達予定日とのずれは、その週の月曜日と到達予定日の差です。',
  /** total は総量を単位付きで書いたもの（例「50時間」）。 */
  outlookTitle: (total: string) => `${total}に届くのは？`,
  recordedTitle: '今日は記録済みです',
  recordedDone: 'やった',
  recordedRest: '休んだ',
  changeRecord: '記録を変更',
  achievedTitle: '決めた総量に届きました',
  achievedBody: '自分で決めた量を積み重ねてきました。ここまでの記録はそのまま残ります。',
  achievedAmount: (done: string, total: string) => `${done} / ${total}。`,
  achievedStart: '記録開始日',
  achievedReached: '届いた日',
  achievedBeforeStart: '記録開始前',
  backToList: 'Goal一覧へ戻る',
  // 今日の記録の選び直し（デザインキャンバス D5-change）
  changeTitle: '今日の記録を変更',
  changeCurrent: (record: string) => `いまの記録：${record}`,
  // Goalのメニュー（デザインキャンバス D1・P3）
  goalMenu: 'Goalのメニュー',
  breadcrumb: '現在の場所',
  menuHistory: '記録の履歴',
  historyLink: '記録の履歴を見る',
  // 記録の履歴（デザインキャンバス F1）と直近7日の帯（P1）
  historyTitle: '記録の履歴',
  backToGoal: 'Goalへ戻る',
  prevMonth: '前の月',
  nextMonth: '次の月',
  monthLabel: (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`,
  dayStateLabel: { done: 'やった', rest: '休んだ', unrecorded: '未記録', outside: '' } as const,
  legendUnrecorded: '未記録（休んだとは別）',
  recentDays: '直近7日の記録',
  recentToday: '今日',
  breadcrumbTrail: (title: string) => `Goal一覧 / ${title}`,
  menuEdit: 'Goalを編集',
  menuCorrectYesterday: '昨日の記録を訂正',
  // 今日から記録を始めたGoal（デザインキャンバス E4、Product Spec P-14の画面文言）
  firstDayNote: '昨日までの分は登録時の累計に含めます。今日の記録漏れは明日補完できます',
  choiceDone: 'やった',
  choiceRest: '今日は休む',
  yesterdayQuestion: '昨日はどうでしたか？',
  yesterdayDone: 'やった',
  yesterdayRest: '休んだ',
  yesterdayLater: '後で答える',
  loading: '最新の見通しを確認しています。',
  networkErrorTitle: '見込みを読み込めませんでした',
  networkError: '通信に失敗しました。記録が足りないという意味ではありません。通信状態を確認して、もう一度お試しください。',
  calcErrorTitle: '見込みを計算できませんでした',
  calcError:
    'これまでの記録はそのまま残っています。記録が足りないという意味ではありません。時間をおいて、もう一度お試しください。今日の記録はこのまま付けられます。',
  calcErrorRecordBlocked: 'これまでの記録はそのまま残っています。記録が足りないという意味ではありません。画面を新しくして、今日の記録を選び直してください。',
  renderErrorTitle: '見通しを表示できません',
  renderError: '表示に使うデータに問題がありました。今日の記録はこのまま付けられます。',
  reload: '再読み込み',
  notFoundTitle: 'Goalが見つかりません',
  notFoundPanel: 'このGoalは開けません',
  notFound: '削除されたか、このアカウントでは開けないGoalです。Goal一覧から開き直してください。',
  backToGoals: 'Goal一覧へ戻る',
  // 記録の保存（R-03・R-04、#79・#80）。デザインキャンバス D5・D7・E1〜E3 に合わせる
  saving: '保存中…',
  savingNote: '保存が終わるまで、このままお待ちください',
  saveFailedTitle: '保存できませんでした',
  saveFailed: (choice: string) => `「${choice}」はまだ記録されていません。通信状態を確認して、もう一度お試しください。`,
  yesterdayFailed: '昨日の記録はまだ入っていません。もう一度選んでください。',
  retrySave: 'もう一度保存',
  reselect: '選び直す',
  settingsConflict: {
    title: 'Goalの設定が変更されました',
    reload: '最新の設定を取得',
    retry: 'この量で再保存',
    body: '入力は保持しています。最新の設定を取得してから、保存する量を確認してください。',
    reloadFailed: '最新の取得に失敗しました。まだ再保存できません。',
    meaningChanged: '単位またはタイムゾーンが変わりました。同じ数字を自動で保存せず、量と対象日を選び直してください。',
  },
  unsavedAmount: (amount: number, label: string) => `未保存の量：${amount}${label}`,
  unsavedRest: '休みの記録は未保存です。',
  dateFailedTitle: 'この日の記録は保存できませんでした',
  dateFailed: (date: string) => `記録できるのは今日と昨日だけです。日付が変わったため、${date}の記録は保存できませんでした。画面を新しくして、今日の記録を選んでください。`,
  refresh: '画面を新しくする',
  signedOutSave: '保存されていません。ログインし直してから、もう一度選んでください。',
  changeNote: '選び直すと、今日の記録を上書きします',
  cancelChange: '変更をやめる',
  todayRecordAmount: (amount: string) => `今日記録する量：${amount}`,
  doneAmount: (amount: string) => `やった量：${amount}`,
  changeAmount: '量を変更',
  amountTodayLabel: '今日記録する量',
  amountYesterdayLabel: '昨日やった量',
  amountHelp: (session: string) => `1回の量（${session}）が初期値です。実際の量に変えられます。`,
  amountInvalid: '1以上の整数を入力してください',
  amountDecrease: '量を減らす',
  amountIncrease: '量を増やす',
  saveWithAmount: 'この量で記録',
  // 記録済みの昨日の訂正（R-04、#80。#88で案Aに決定）
  yesterdaySummary: (date: string, record: string) => `昨日（${date}）：${record}`,
  yesterdayChange: '変更',
  todaySummary: (date: string, record: string) => `今日（${date}）：${record}`,
  todayChangeLabel: (date: string) => `今日（${date}）の記録を変更`,
  yesterdayChangeLabel: (date: string) => `昨日（${date}）の記録を変更`,
  yesterdayCorrectTitle: (date: string) => `昨日（${date}）の記録を変更`,
  yesterdayCorrectNote: (current: string) => `今の記録：${current}。選び直して「変更を保存」を押すと上書きします。`,
  saveChange: '変更を保存',
  cancel: 'キャンセル',
  correctFailed: (choice: string, current: string) =>
    `「${choice}」への変更はまだ保存されていません。昨日の記録は「${current}」のままです。通信状態を確認して、もう一度お試しください。`,
  dateChangedTitle: '日付が変わりました',
  dateChanged: (date: string) => `${date}の記録の変更は保存していません。画面を新しくして、選び直してください。`,
  otherEditing: '昨日の記録の変更を終えてから選べます',
  savedButStaleTitle: '記録は保存しました',
  savedButStale: '最新の見通しを読み込めませんでした。表示が古いままかもしれません。通信状態を確認して、再読み込みしてください。',
  back: '戻る',
  // R-11 の出所と計画（#137）。出所の名前と説明は PR #120 の sourceLabel・sourceNote を使う
  planReason: (aMissing: boolean, bMissing: boolean) =>
    aMissing && bMissing
      ? '「取り組めた日の翌日」と「休んだ日の翌日」の材料が不足しています。'
      : aMissing
        ? '「取り組めた日の翌日」の材料が不足しています。'
        : bMissing
          ? '「休んだ日の翌日」の材料が不足しています。'
          : '見通しを出すための材料がまだ足りません。',
  planTitle: '設定量で行う場合の残り',
  planSessions: (n: number) => `あと${n.toLocaleString('ja-JP')}回分`,
  planNote: (remaining: string, session: string, last: string) =>
    `残り${remaining}。1回${session}の設定量で行う場合。最後に必要な量は${last}です。これは日数の予測ではありません。`,
  sourcesTitle: '見通しの材料',
  sourceA: '取り組めた日の翌日',
  sourceB: '休んだ日の翌日',
  questionAssumption: '初期の回答は仮定です。',
  whyQuestion: '最初の質問の回答を、弱い初期の仮定として使っています。回答は実績や記録には加えず、記録がたまるほど回答の影響は小さくなります。',
  answerQuestions: '質問に答えて、最初の見通しを調整する（任意）',
  inconsistentTitle: '表示をそろえられませんでした',
  inconsistent: 'Goal・記録・見通しを同じ時点の内容で読み込めませんでした。別の画面で変更が続いている可能性があります。もう一度読み込んでください。',
  signedOutTitle: 'ログインが切れました',
  signedOut: '続けるには、もう一度ログインしてください。記録や見通しが消えたわけではありません。',
  signIn: 'ログインする',
} as const;

/** 材料の出所（R-11）。記録だけ・回答だけ・両方。 */
type NoteSource = 'RECORDS' | 'QUESTION' | 'QUESTION_AND_RECORDS';

const coreNoteTail = '今日休んだ場合、次に再開するまでの日数の中央値です。同じ継続傾向と設定量で続け、再開後に同じ道をたどるモデルでは、完了が遅れる日数の中央値とも解釈できます。完了日の中央値どうしの差や、実際の因果効果を表すものではなく、将来を保証するものではありません。';

/**
 * 中心指標の注釈を出所に合わせる。記録だけのときは Product Spec の固定文言（coreNote）のまま。
 * 回答を使うときは「あなたの記録から」を流用しない（Product Spec「Today Decision画面の表示仕様」、R-11）。
 */
export function coreNoteFor(source: NoteSource): string {
  if (source === 'RECORDS') return todayCopy.coreNote;
  if (source === 'QUESTION') return `最初の質問の回答から置いた「休んだ後の再開傾向」の仮定をもとに計算しています。まだ記録からは推定していません。${coreNoteTail}`;
  return `最初の質問の回答と、あなたの記録から推定した「休んだ後の再開傾向」をもとに計算しています。${coreNoteTail}`;
}

/** 補助指標2の注釈を a／b の出所に合わせる。どちらも記録だけのときは Product Spec の固定文言（completionNote）のまま。 */
export function completionNoteFor(sources: { a: NoteSource; b: NoteSource }): string {
  if (sources.a === 'RECORDS' && sources.b === 'RECORDS') return todayCopy.completionNote;
  if (sources.a === 'QUESTION' && sources.b === 'QUESTION') return '完了の目安は、最初の質問の回答から置いた継続傾向の仮定をもとに計算した見込みです。まだ記録からは推定していません。';
  return '完了の目安は、最初の質問の回答と、あなたの記録から推定した継続傾向をもとに計算した見込みです。';
}
