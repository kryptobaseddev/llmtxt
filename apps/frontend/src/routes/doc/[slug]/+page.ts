import { api } from '$lib/api/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  const { slug } = params;

  const [doc, overview, versions, approvals, contributors] = await Promise.allSettled([
    api.getDocument(slug),
    api.getOverview(slug),
    api.getVersions(slug),
    api.getApprovals(slug),
    api.getContributors(slug),
  ]);

  return {
    slug,
    doc: doc.status === 'fulfilled' ? doc.value : null,
    overview: overview.status === 'fulfilled' ? overview.value : null,
    versions: versions.status === 'fulfilled' ? versions.value : null,
    approvals: approvals.status === 'fulfilled' ? approvals.value : null,
    contributors: contributors.status === 'fulfilled' ? contributors.value : null,
  };
};
