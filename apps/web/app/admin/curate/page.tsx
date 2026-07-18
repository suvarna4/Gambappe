import { Suspense } from 'react';
import CurationClient from './CurationClient';

export default function CuratePage() {
  return (
    <Suspense fallback={null}>
      <CurationClient />
    </Suspense>
  );
}
