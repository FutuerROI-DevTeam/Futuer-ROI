/**
 * デスクトップ幅（2列の並び）に切り替えるしきい値。
 * CSS の `@media (min-width: 960px)`（page.css・today.css・goals.css・history.css）と同じ値にし、
 * JS で DOM の順番や開閉の初期値を変えるときも、CSS の並びと食い違わないようにする。
 */
export const WIDE_LAYOUT_QUERY = '(min-width: 960px)';
