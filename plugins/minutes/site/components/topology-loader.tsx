'use client';

import dynamic from 'next/dynamic';

const ConversationTopology = dynamic(
  () => import('./conversation-topology').then((m) => m.ConversationTopology),
  { ssr: false },
);

export function TopologyLoader() {
  return <ConversationTopology />;
}
