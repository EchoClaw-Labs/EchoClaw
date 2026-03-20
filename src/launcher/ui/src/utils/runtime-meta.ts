import type { ProviderName } from "../../../../providers/types.js";
import {
  RUNTIME_CATALOG,
  runtimeLabel as sharedRuntimeLabel,
} from "../../../../shared/runtime-catalog.js";

export interface RuntimeOption {
  key: ProviderName;
  label: string;
  description: string;
  recommended: boolean;
}

/** External providers/runtimes for skill linking (left side of wizard step 3) */
export const RUNTIME_OPTIONS: RuntimeOption[] = RUNTIME_CATALOG.map((m) => ({
  ...m,
  recommended: false,
}));

export const runtimeLabel = sharedRuntimeLabel;
