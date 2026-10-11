import type { ReactNode } from 'react';
import { InsufficientNotice } from '../../ui/components/Notice.tsx';
import { Icon } from '../../ui/components/Icon.tsx';
import { coreNoteFor, todayCopy } from '../../copy/today.ts';
import { sourceNote } from '../prior/PriorForecast.tsx';
import type { CorePresentation, SufficientSource } from '../prior/presentation-types.ts';

/**
 * 問い・中心の数字・要約・計算の根拠（デザイン案Bの上部）。
 * R-11 で回答由来の数字のときは、要約を出所に合わせる（デザインキャンバス R2・R3）。要約が同じことを伝えるため、「回答」などのラベルは出さない（#221）。
 * 記録だけのときは、Product Spec P-12 の固定文言のまま。
 * 補助指標1「休んだ翌日にやれたのは ○回中○回」は出さない（2026-10-08、依頼者判断による P-12 の改訂。#146）。
 */
export function CoreMetric({ core, children, guidance }: { core: CorePresentation; children?: ReactNode; guidance?: ReactNode }) {
  if (core.kind === 'insufficient') {
    return (
      <>
        <div className="fr-today__hero">
          {children}
          <InsufficientNotice>{core.message ?? todayCopy.insufficientCore}</InsufficientNotice>
        </div>
        {guidance ? <div className="fr-today__basis">{guidance}</div> : null}
      </>
    );
  }
  return (
    <>
      <div className="fr-today__hero">
        {children}
        <div className="fr-core">
          <p className="fr-core__label">{todayCopy.coreLabel}</p>
          <p className="fr-core__value">
            <small>約</small>
            {core.days}
            <small>日</small>
          </p>
        </div>
      </div>
      <div className="fr-today__basis">
        <p className="fr-today__summary">{core.source === 'RECORDS' ? todayCopy.coreSummary : sourceNote(core.source)}</p>
        <WhyDetails source={core.source} />
      </div>
    </>
  );
}

/** 計算の根拠（開閉）。中心指標の注釈の全文をここに置く。記録だけのときは Product Spec の固定文言、回答を使うときは出所に合わせた文言。 */
export function WhyDetails({ source = 'RECORDS' }: { source?: SufficientSource }) {
  return (
    <details className="fr-why">
      <summary>
        {todayCopy.whyTitle}
        <Icon name="chevronDown" size={20} />
      </summary>
      <div className="fr-why__body">
        <p>{coreNoteFor(source)}</p>
        {source === 'RECORDS' ? null : <p>{todayCopy.whyQuestion}</p>}
      </div>
    </details>
  );
}
