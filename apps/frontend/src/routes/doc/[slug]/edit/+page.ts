import { api } from '$lib/api/client';
import type { PageLoad } from './$types';

export const prerender = false;

export const load: PageLoad = async ({ params }) => {
  const { slug } = params;

  const [doc, raw] = await Promise.allSettled([
    api.getDocument(slug),
    api.getRawContent(slug),
  ]);

  const rawContent = raw.status === 'fulfilled' ? raw.value : '';

  return {
    slug,
    doc: doc.status === 'fulfilled' ? doc.value : null,
    originalContent: rawContent,
  };
};
