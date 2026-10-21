import type { ComponentType, ReactNode } from "react";
import type { KpiKey } from "../_lib/dashboard-view";
import type { IconName } from "../_lib/navigation";

type SvgProps = { readonly children: ReactNode; readonly size?: number };

/** Shared 24px stroke icon frame; the colour comes from `currentColor`. */
function Svg({ children, size = 20 }: SvgProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const HomeIcon = () => (
  <Svg>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9.5h13V10" />
    <path d="M10 19.5v-5h4v5" />
  </Svg>
);

const FleetIcon = () => (
  <Svg>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="2" />
    <circle cx="17" cy="17.5" r="2" />
  </Svg>
);

const UsersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" />
    <path d="M18 14.3c2 .7 3.5 2.5 3.5 5.7" />
  </Svg>
);

const OrganizationIcon = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-4h12v4" />
  </Svg>
);

const ICONS: Readonly<Record<IconName, ComponentType>> = {
  home: HomeIcon,
  fleet: FleetIcon,
  users: UsersIcon,
  organization: OrganizationIcon,
};

/** The icon registered for a navigation entry. */
export function NavIcon({ name }: { readonly name: IconName }) {
  const Component = ICONS[name];
  return <Component />;
}

const SupplierIcon = () => (
  <Svg>
    <path d="M4 10 5.5 4h13L20 10" />
    <path d="M4 10h16v10H4z" />
    <path d="M9 20v-5h6v5" />
  </Svg>
);

const AssetTypeIcon = () => (
  <Svg>
    <path d="M3.5 12.5V4.5h8l9 9-8 8z" />
    <circle cx="8" cy="9" r="1.2" />
  </Svg>
);

const OperationIcon = () => (
  <Svg>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

const SiteIcon = () => (
  <Svg>
    <path d="M12 21s7-6 7-11.5A7 7 0 0 0 5 9.5C5 15 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

const KPI_ICONS: Readonly<Record<KpiKey, ComponentType>> = {
  equipment: FleetIcon,
  suppliers: SupplierIcon,
  assetTypes: AssetTypeIcon,
  divisions: OrganizationIcon,
  operations: OperationIcon,
  sites: SiteIcon,
};

/** The icon of a dashboard card. */
export function KpiIcon({ name }: { readonly name: KpiKey }) {
  const Component = KPI_ICONS[name];
  return <Component />;
}

export const MenuIcon = () => (
  <Svg size={22}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg size={22}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const ChevronDownIcon = () => (
  <Svg size={16}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const LogoutIcon = () => (
  <Svg>
    <path d="M10 4H5v16h5" />
    <path d="M14 8l4 4-4 4M18 12H9" />
  </Svg>
);

/** Brand mark: a parking "P" inside a rounded square. */
export const BrandMark = () => (
  <svg className="brand-mark" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect width="24" height="24" rx="6" fill="currentColor" />
    <path
      d="M9 18V6h4.2a3.4 3.4 0 0 1 0 6.8H9"
      fill="none"
      stroke="var(--sidebar)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
