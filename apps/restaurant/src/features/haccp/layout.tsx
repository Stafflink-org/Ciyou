import type { ReactNode } from 'react';
import { PageHeader } from '@golink/ui';
import { SubNav } from '../_rh/ui';
import { HACCP_NAV } from './data';

export function HaccpHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <PageHeader eyebrow="Plan de maîtrise sanitaire" title={title} description={description} actions={actions}>
      <SubNav items={HACCP_NAV} />
    </PageHeader>
  );
}
