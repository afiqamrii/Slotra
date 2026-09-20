import type { LucideIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";

type PlaceholderPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  action?: string;
};

export function PlaceholderPage({ title, description, icon, emptyTitle, emptyDescription, action }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader eyebrow="WORKSPACE / PREVIEW" title={title} description={description} />
      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} action={action} />
    </>
  );
}
