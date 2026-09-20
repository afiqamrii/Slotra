import {
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  House,
  LayoutGrid,
  Megaphone,
  NotebookTabs,
  Settings2,
  UsersRound,
} from "lucide-react";

export const navigation = [
  { label: "Home", href: "/dashboard", icon: House },
  { label: "Bookings", href: "/bookings", icon: NotebookTabs },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Customers", href: "/customers", icon: UsersRound },
  { label: "Courts & Spaces", href: "/courts-and-spaces", icon: LayoutGrid },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Reports", href: "/reports", icon: ChartNoAxesCombined },
  { label: "Grow", href: "/grow", icon: Megaphone },
  { label: "Settings", href: "/settings", icon: Settings2 },
] as const;
