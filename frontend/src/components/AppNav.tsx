'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, FileText, History, Workflow } from 'lucide-react';
import { getBoardHref } from '@/lib/studio-session';

interface AppNavProps {
  boardHref?: string;
}

const LINKS = [
  { href: '/artifacts', label: 'Documents', icon: FileText, match: (path: string) => path.startsWith('/artifacts') || path.startsWith('/documents') },
  { href: '/runs', label: 'Runs', icon: History, match: (path: string) => path.startsWith('/runs') },
  { href: '/caches', label: 'Caches', icon: Database, match: (path: string) => path.startsWith('/caches') },
];

export function AppNav({ boardHref }: AppNavProps) {
  const pathname = usePathname() || '/';
  const [storedBoardHref, setStoredBoardHref] = useState('/');

  useEffect(() => {
    setStoredBoardHref(getBoardHref());
  }, [pathname]);

  const homeHref = boardHref || storedBoardHref;
  const onBoard = pathname === '/' || pathname.startsWith('/flow/');

  return (
    <nav className="app-nav" aria-label="Primary">
      <Link href={homeHref} className="app-nav-brand">
        <Workflow size={16} />
        <span>Flow Studio</span>
      </Link>
      <div className="app-nav-links">
        <Link href={homeHref} className={`app-nav-link${onBoard ? ' active' : ''}`} aria-current={onBoard ? 'page' : undefined}>
          Board
        </Link>
        {LINKS.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`app-nav-link${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={14} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
