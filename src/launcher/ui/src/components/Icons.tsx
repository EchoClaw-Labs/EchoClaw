/**
 * Hugeicons barrel — centralized re-exports for Launcher UI.
 * Same pattern as agent ui icons.ts.
 * Keeps old export names for backward compatibility with DashboardView/Navbar.
 */

export { HugeiconsIcon } from "@hugeicons/react";
export type { IconSvgElement } from "@hugeicons/react";

export {
  Wallet01Icon as WalletIcon,
  CpuIcon,
  Link01Icon as LinkIcon,
  ServerStackIcon as ServerIcon,
  Activity01Icon as ActivityIcon,
  Shield01Icon as ShieldIcon,
  BridgeIcon,
  Settings01Icon as SettingsIcon,
  CompassIcon,
  ComputerTerminalIcon as TerminalIcon,
  ArrowDown01Icon as ChevronDownIcon,
  Refresh01Icon as RefreshIcon,

  // Agent status icons (replace emoji)
  CheckmarkCircle02Icon,
  BotIcon,
} from "@hugeicons/core-free-icons";
