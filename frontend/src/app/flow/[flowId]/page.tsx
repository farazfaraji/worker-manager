'use client';

import React from 'react';
import { FlowStudio } from '@/components/FlowStudio';

export default function FlowPage({ params }: { params: { flowId: string } }) {
  return <FlowStudio initialFlowId={params?.flowId} />;
}
