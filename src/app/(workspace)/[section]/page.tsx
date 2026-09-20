import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ChartNoAxesCombined,
  CreditCard,
  LayoutGrid,
  Megaphone,
  Settings2,
  UsersRound,
} from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

const pages = {
  customers: {
    title: "Customers",
    description: "Keep the people who play at your venue in one place.",
    icon: UsersRound,
    emptyTitle: "No customers yet",
    emptyDescription: "Customer details will appear here as bookings are added.",
    action: "Add Customer",
  },
  "courts-and-spaces": {
    title: "Courts & Spaces",
    description: "Organize the spaces people can book at your venue.",
    icon: LayoutGrid,
    emptyTitle: "Your spaces will live here",
    emptyDescription: "Add courts, lanes, fields or other bookable spaces when venue setup is ready.",
    action: "Add Space",
  },
  payments: {
    title: "Payments",
    description: "Track what has been paid and what still needs attention.",
    icon: CreditCard,
    emptyTitle: "No payments to show",
    emptyDescription: "Payment activity will appear here when payment tracking is connected.",
  },
  reports: {
    title: "Reports",
    description: "Find the numbers that help you run your venue.",
    icon: ChartNoAxesCombined,
    emptyTitle: "Insights are on the way",
    emptyDescription: "Clear reports will appear here once real booking and payment data is available.",
  },
  grow: {
    title: "Grow",
    description: "Bring players back and make more of every open hour.",
    icon: Megaphone,
    emptyTitle: "Growth tools are coming",
    emptyDescription: "Promotions and customer engagement tools will live here in a future phase.",
  },
  settings: {
    title: "Settings",
    description: "Make the workspace fit the way your venue runs.",
    icon: Settings2,
    emptyTitle: "Settings are coming",
    emptyDescription: "Organization, branch and team preferences will be available after setup is connected.",
  },
};

type Props = { params: Promise<{ section: string }> };

export function generateStaticParams() {
  return Object.keys(pages).map((section) => ({ section }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: pages[section as keyof typeof pages]?.title || "Not found" };
}

export default async function SectionPage({ params }: Props) {
  const { section } = await params;
  const page = pages[section as keyof typeof pages];
  if (!page) notFound();
  return <PlaceholderPage {...page} />;
}
