# Session milestone numeric oracle

Supporting Artifact / Not Source of Truth。#248の[設計補助](../../docs/prediction/milestone-calibration.md)にある1係数fitの独立計算。履歴や本試験群は生成せず、TS helperをimportしない。Python標準`decimal`だけで直接確率のlogを70桁、240二分で計算する。

`python experiments/session-milestone-oracle/oracle.py`をrepository rootで実行する。EVENTとCENSORの内点u/目的/勾配を出力する。[core回帰](../../apps/api/tests/milestone-core.test.ts)の固定expectedはこの独立結果と照合する。3同一分布を平均した数学例なので、人数・実績・効用の推定には使わない。
