// #275: 初回Windows配備のCRLF履歴との互換を、監査済み8ファイルだけに限定する。
// 34d749745a4493541ac1279dfd32921b1ec27c4d と e56f208ce6cc2eadebbc636f724155e66fc5540a
// のGit blobは同一。各pairはそのLF原文と、全LFをCRLFにした原文のSHA-256。
// SQLの正規化や実行・記録の変更はしない。将来のSQLをこの表へ自動追加しない。
const legacyChecksums: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['0001_goal_action_log.sql', [
    '581215086471dd61b8cc578a1e981951e653b9371c2c0f02c3558140f6fc9a3e',
    '3d4249be53dc1edc310c1ad4c6836ea94fcfde2422102a4e7bbf505ed3f546fb',
  ]],
  ['0002_goal_record_start_date.sql', [
    'c0af1c9e65ea724b15e9072c4ce843e6b66ad52d99714b52993508d9a23a5237',
    'b7e367624f94fdea96a49092de9696880f4b3ab2653a0ac3bb8d7526ef9cbcc5',
  ]],
  ['0003_goal_question_prior.sql', [
    '6b9e3cecaebbff03b3f413de2c56124723b62c75a818059c2b40bc374395e99f',
    '45afdd790c4cdd7375409178ed757c261433eb8758108b3b06770fc67232145c',
  ]],
  ['0004_demo_seed_goal.sql', [
    '36300b24ffe35dc8d7b4ad971b4e8612f87df8f881e60a2ce9d405d74776e3a4',
    'd235d2d774612ac58025e01a190144f42ed5cb8324ebe85e8bea6064b76298c3',
  ]],
  ['0005_goal_data_integrity.sql', [
    '1d1ca6ee04c045f4e7454530cb7df8b40978a54b262765a7faf0798fa4308851',
    'bcec0230e3b4dd4487b2da8537b0c25a7a8dbc5fc853f670d1b13db1870aa5a9',
  ]],
  ['0005_goal_target_date.sql', [
    '26dcd46e76ac663235e5cc4f725bb8de61d6fa3427340316c31a756d6389299f',
    'd8b66c10d531e5519539ae7d9997b9fc59acbee785a3f0afbc2db2e4aac957b2',
  ]],
  ['0006_prediction_evaluation.sql', [
    'a3fce792f16898fa59157097a8757f6f0be3ae461b41e5d366975afa74779556',
    '11de0d4aa993fd87573147f9643f9286edcf0cf29fa9d0831fa0c8f6db316d55',
  ]],
  ['0008_session_milestone.sql', [
    'af652ff8f19ef49d05bde8c1792b7d46757db5084c166529188dd07cce139683',
    '1bb9d672c53536e24ed5a58c748d185c490a2f58d265687179f37b0cdab554b6',
  ]],
]);

export function matchesMigrationChecksum(name: string, current: string, recorded: string): boolean {
  if (current === recorded) return true; // 従来のraw完全一致は保持する。
  const pair = legacyChecksums.get(name);
  return pair !== undefined && pair.includes(current) && pair.includes(recorded);
}
