'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from './lib';

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace(getSession() ? '/appointments' : '/login'); }, [router]);
  return null;
}
