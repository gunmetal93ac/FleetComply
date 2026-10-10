/**
 * Top-level navigation.
 *
 * FleetComply is focused on the compliance guide. The fleet-management
 * sections below are hidden from navigation but their routes, code and data
 * are intact — set `hidden: false` to bring one back.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Only shown to signed-in users (the page requires an account). */
  auth?: boolean;
  /** Only shown to FleetComply platform administrators. The page enforces this server-side as well. */
  platformAdmin?: boolean;
  hidden?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/#scenarios", label: "Browse scenarios" },
  { href: "/library", label: "Regulatory library" },
  { href: "/runs", label: "Saved checklists", auth: true },
  { href: "/settings", label: "Settings", auth: true },
  { href: "/admin/regulatory", label: "Regulatory Intelligence", auth: true, platformAdmin: true },

  // Hidden fleet-management features (preserved).
  { href: "/dashboard", label: "Dashboard", auth: true, hidden: true },
  { href: "/workflows", label: "Compliance Workflows", auth: true, hidden: true },
  { href: "/drivers", label: "Drivers", auth: true, hidden: true },
  { href: "/vehicles", label: "Vehicles", auth: true, hidden: true },
  { href: "/documents", label: "Documents", auth: true, hidden: true },
  { href: "/calendar", label: "Compliance Calendar", auth: true, hidden: true },
  { href: "/assistant", label: "AI Assistant", auth: true, hidden: true },
  { href: "/reports", label: "Reports", auth: true, hidden: true },
];

export function navFor(signedIn: boolean, platformAdmin = false): NavItem[] {
  return NAV.filter((n) => !n.hidden && (!n.auth || signedIn) && (!n.platformAdmin || (signedIn && platformAdmin)));
}
