import { DEFAULT_CONFIG } from './config.js';
import { observe } from './observations.js';
import { recoveryQuantiles } from './recovery.js';
import { completionFromValidatedState } from './completion-scenario.js';
import { PredictionConfigError } from './errors.js';
import type { Completion, CoreMetric, PredictionResult, PredictionConfig, PredictionInput, Posterior } from './types.js';

function validateConfig(config: PredictionConfig): void {
  for (const field of ['prior', 'samples', 'horizonDays'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new PredictionConfigError('INVALID_INTEGER', [field], `${field} must be a positive safe integer`);
    }
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new PredictionConfigError('INVALID_SEED', ['seed'], 'seed must be uint32');
  }
  // ラベルだけを変更して別モデルを実装した扱いにしない。
  if (config.modelVersion !== DEFAULT_CONFIG.modelVersion) {
    throw new PredictionConfigError('UNSUPPORTED_MODEL', ['modelVersion'], 'Unsupported modelVersion');
  }
  if (config.completionMethod !== undefined && !['auto', 'sampled'].includes(config.completionMethod)) {
    throw new PredictionConfigError('UNSUPPORTED_METHOD', ['completionMethod'], 'Unsupported completion method');
  }
}

export function predict(input: PredictionInput, config: PredictionConfig = DEFAULT_CONFIG): PredictionResult {
  const prior = { a: { alpha: config.prior, beta: config.prior },
    b: { alpha: config.prior, beta: config.prior } };
  const result = calculateWithPrior(input, config, prior);
  return { ...result, config: { prior: config.prior, ...result.config } };
}

// Goal別priorの候補を同じ数値経路で検証する内部境界。index.tsには公開しない。
// 共通priorを使ったと誤認させないよう、内部結果のconfigにはスカラーpriorを入れない。
export type PriorCalculation = Omit<PredictionResult, 'config'> & {
  config: Omit<PredictionResult['config'], 'prior'>;
};

export function calculateWithPrior(input: PredictionInput, config: PredictionConfig,
  prior: Posterior): PriorCalculation {
  validateConfig(config);
  const { counts, actualDone, todayStatus, observationWindow, recordedLogCount } = observe(input);
  const posterior = {
    a: { alpha: prior.a.alpha + counts.nDD, beta: prior.a.beta + counts.nDS },
    b: { alpha: prior.b.alpha + counts.nSD, beta: prior.b.beta + counts.nSS },
  };
  for (const parameter of ['a', 'b'] as const) {
    for (const shape of ['alpha', 'beta'] as const) {
      if (!Number.isSafeInteger(posterior[parameter][shape])) {
        throw new PredictionConfigError('UNSAFE_POSTERIOR', ['posterior', parameter, shape],
          'prior + transition count exceeds exact integer range for posterior shape');
      }
    }
  }
  const completed = actualDone >= input.goal.totalRequired;
  let coreMetric: CoreMetric;
  let completion: Completion;
  if (completed) {
    coreMetric = { status: 'not_applicable', reason: 'COMPLETED' };
    completion = { status: 'completed' };
  } else {
    if (todayStatus !== 'UNRECORDED') {
      coreMetric = { status: 'not_applicable', reason: 'TODAY_RECORDED' };
    } else if (counts.nSD + counts.nSS === 0) {
      coreMetric = { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' };
    } else {
      coreMetric = { status: 'available', ...recoveryQuantiles(posterior.b.alpha, posterior.b.beta) };
    }

    if (counts.nDD + counts.nDS === 0) {
      completion = { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' };
    } else if (counts.nSD + counts.nSS === 0) {
      completion = { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' };
    } else {
      completion = completionFromValidatedState(input.goal, actualDone, todayStatus, posterior, config);
    }
  }
  return {
    modelVersion: config.modelVersion, today: input.today, todayStatus,
    progress: { done: actualDone, total: input.goal.totalRequired, completed },
    // step1の実際の観測窓を説明する。遷移を数える条件は変えない。
    // 空の履歴だけは観測開始日がなく、そのため観測窓の暦日数も0になる。
    observations: { ...counts, effectiveTransitions: counts.nDD + counts.nDS + counts.nSD + counts.nSS,
      observedDays: observationWindow?.calendarSlots ?? 0, recordedDays: recordedLogCount },
    posterior, coreMetric, completion,
    config: { samples: config.samples, horizonDays: config.horizonDays, seed: config.seed },
  };
}
