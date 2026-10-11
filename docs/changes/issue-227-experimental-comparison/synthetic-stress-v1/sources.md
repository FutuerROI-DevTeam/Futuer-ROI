# 一次出典とstressの設計仮定

Supporting Artifact / Not a Source of Truth。文献は生成系統を選ぶ現象の参考であり、Future ROIの予測精度・再開hazardや下記パラメータの実測根拠ではない。論文の個票は取得・fitしていない。

| 文献 | 参考現象 | このstressで別に置いた仮定 |
| --- | --- | --- |
| [Doherty et al. 2017, PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0169649) | 活動の曜日差。論文の平日／週末差は小さい | DONE確率.60/.25と逆方向の差 |
| [Tison et al. 2020, Annals of Internal Medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC7384265/) | 外的状況に伴う身体活動変化 | .65/.20、変更日45/61。61日目の未来shockを予見できるとは扱わない |
| [Peach et al. 2019, npj Science of Learning](https://link.springer.com/article/10.1038/s41539-019-0054-0) | 学習参加の時間的異質性、分散／集中／sporadicな行動 | 非幾何renewalのD長1/2/3、S長1/4/14とmassは論文の推定分布ではない |
| [Barenberg et al. 2018, Psychology Learning & Teaching](https://journals.sagepub.com/doi/10.1177/1475725718769488) | 試験前への学習集中と分散の違い | 14日周期、最後3日の.80、他.15 |
| [Brady et al. 2023, HABITAT / BMC Public Health](https://link.springer.com/article/10.1186/s12889-023-16734-0) | 日々の身体活動量の変動 | 実量.5/1/1.5とmass .25/.50/.25 |
| [Cho et al. 2025, JMIR mHealth and uHealth](https://mhealth.jmir.org/2025/1/e65350) | 欠測とnonrandom missingness | PA dataset全体欠測18.4%だけ数値参考。独立MCAR、P(U\|D)=.05/P(U\|S)=.30、24–30/54–60日の配置は別仮定 |

iid .45とMarkov .70/.30は設計上の定常対照。primary本文の現象と確率・run長・配置の数値仮定を混同しない。256未来は履歴ごとのMC反復であり、独立の実ユーザーではない。
