import { Outlet } from '@tanstack/react-router';
import { appCopy } from '../copy/app.ts';
import { AccountMenu } from '../features/account/AccountMenu.tsx';
import { MainLandmark } from './MainLandmark.tsx';
import '../ui/tokens.css';
import './app-shell.css';

/**
 * ログインが必要な画面の外側（router.tsx の [app] のまとまり）。
 * デスクトップ幅では、画面の幅いっぱいの上のバー（アプリ名とアカウント）を出す（デザイン Desk-home・Desk-today）。
 * スマートフォン幅では出さず、各画面の上のバー（AppBar）を使う。
 */
export function AppShell() {
  return (
    <>
      <header className="fr fr-deskbar">
        <p className="fr-deskbar__name">{appCopy.name}</p>
        <AccountMenu variant="email" />
      </header>
      <MainLandmark>
        <Outlet />
      </MainLandmark>
    </>
  );
}
