import { EchoError, ErrorCodes } from "../../errors.js";

export function requireYes(yes: boolean | undefined, action: string): void {
  if (!yes) {
    throw new EchoError(
      ErrorCodes.CONFIRMATION_REQUIRED,
      `On-chain action requires confirmation: ${action}`,
      "Add --yes to confirm."
    );
  }
}
