import { Suspense } from 'react';
import ModerationClient from './ModerationClient';

export default function ModerationPage() {
  return (
    <Suspense fallback={null}>
      <ModerationClient />
    </Suspense>
  );
}
