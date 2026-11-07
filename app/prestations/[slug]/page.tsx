// Public service pages (FASTSPLIT-PUBLIC-SERVICE-PAGES-001): one static page per home card.
// Unknown slugs are 404 (dynamicParams off + explicit notFound()).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { money } from "@/components/app/format";
import { PublicServicePage } from "@/components/role/public-service-page";
import { SERVICES, serviceBySlug, serviceEstimate } from "@/components/role/public-service-catalog";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const service = serviceBySlug((await params).slug);
  if (!service) return {};
  const e = serviceEstimate(service.category);
  return {
    title: `${service.title} — Dépannage électrique`,
    description: `${service.intro} Estimation indicative : ${money(e.min)} – ${money(e.max)}, confirmée par un devis.`,
  };
}

export default async function Page({ params }: Props) {
  const service = serviceBySlug((await params).slug);
  if (!service) notFound();
  return <PublicServicePage service={service} />;
}
