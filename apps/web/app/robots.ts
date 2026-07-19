/**
 * `/robots.txt` (Next.js App Router file convention, WS8-T5). Not otherwise spec'd by the design
 * doc; added because Lighthouse's SEO category scores a `robots-txt` audit (malformed/missing
 * directives) and disallowing admin/API surfaces from crawling is standard hygiene alongside the
 * `/q` archive + structured data this task otherwise adds.
 */
import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/app-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/'],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
