'use client';

import React from 'react';
import { AlertCircle, Ban, CheckCircle2, Clock, Loader2, LucideIcon, XCircle } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  completed: CheckCircle2,
  failed: XCircle,
  waiting: Clock,
  running: Loader2,
  listening: Loader2,
  partial: AlertCircle,
  cancelled: Ban,
  queued: Clock,
};

export function RunStatusBadge({ status, iconSize = 14 }: { status: string; iconSize?: number }) {
  const Icon = ICONS[status] || Clock;
  const spinning = status === 'running' || status === 'listening';
  return (
    <span className={`run-status run-status-${status}`}>
      <Icon size={iconSize} className={spinning ? 'animate-spin' : undefined} />
      {status === 'waiting' ? 'Waiting' : status}
    </span>
  );
}
