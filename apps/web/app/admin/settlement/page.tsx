import { Suspense } from 'react';
import SettlementClient from './SettlementClient';

export default function SettlementPage() {
  return (
    <Suspense fallback={null}>
      <SettlementClient />
    </Suspense>
  );
}
