import { createContext, useContext, type ReactNode } from 'react';

const InsideMain = createContext(false);

/**
 * 画面の本文の目印（`<main>`、#237）。読み上げソフトの「本文へ移動」で飛べるようにする。
 * ログイン後の画面は AppShell が1つ付ける。404・エラー・読込中の画面は AppShell の中でも外でも出るため、
 * すでに `<main>` の中にいるときは `<div>` にして、1画面に `<main>` が2つできないようにする。
 */
export function MainLandmark({ className, children }: { className?: string; children: ReactNode }) {
  if (useContext(InsideMain)) return <div className={className}>{children}</div>;
  return (
    <InsideMain.Provider value={true}>
      <main className={className}>{children}</main>
    </InsideMain.Provider>
  );
}
