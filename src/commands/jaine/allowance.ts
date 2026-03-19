import { Command } from "commander";
import { maxUint256, formatUnits } from "viem";
import { loadConfig } from "../../config/store.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { resolveToken } from "../../jaine/coreTokens.js";
import { loadUserTokens } from "../../jaine/userTokens.js";
import {
  getAllAllowances,
  revokeApproval,
  getSpenderAddress,
  type SpenderType,
} from "../../jaine/allowance.js";
import { getTokenDecimals, getTokenSymbolOnChain } from "./helpers.js";

export function createAllowanceSubcommand(): Command {
  const allowance = new Command("allowance")
    .description("Manage token approvals for Jaine contracts")
    .exitOverride();

  allowance
    .command("show <token>")
    .description("Show current allowances for a token")
    .option("--spender <type>", "Spender type (router|nft)", "router")
    .action(async (token: string, options: { spender: string }) => {
      const cfg = loadConfig();
      if (!cfg.wallet.address) {
        throw new EchoError(ErrorCodes.WALLET_NOT_CONFIGURED, "No wallet configured.");
      }

      const userTokens = loadUserTokens();
      const tokenAddr = resolveToken(token, userTokens.aliases);

      const allowances = await getAllAllowances(tokenAddr, cfg.wallet.address);
      const decimals = await getTokenDecimals(tokenAddr);
      const symbol = await getTokenSymbolOnChain(tokenAddr);

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          allowances: {
            router: allowances.router.toString(),
            nft: allowances.nft.toString(),
          },
          formatted: {
            router: allowances.router === maxUint256 ? "unlimited" : formatUnits(allowances.router, decimals),
            nft: allowances.nft === maxUint256 ? "unlimited" : formatUnits(allowances.nft, decimals),
          },
        });
      } else {
        const formatAllowance = (val: bigint) =>
          val === maxUint256 ? colors.success("unlimited") : colors.value(formatUnits(val, decimals));

        infoBox(
          `Allowances for ${symbol}`,
          `Router: ${formatAllowance(allowances.router)}\n` + `NFT Manager: ${formatAllowance(allowances.nft)}`
        );
      }
    });

  allowance
    .command("revoke <token>")
    .description("Revoke approval for a token")
    .option("--spender <type>", "Spender type (router|nft)", "router")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (token: string, options: { spender: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const { privateKey } = requireWalletAndKeystore();
      const userTokens = loadUserTokens();
      const tokenAddr = resolveToken(token, userTokens.aliases);
      const spenderAddr = getSpenderAddress(options.spender as SpenderType);

      const spin = spinner("Revoking approval...");
      spin.start();

      const txHash = await revokeApproval(tokenAddr, spenderAddr, privateKey);
      spin.succeed("Approval revoked");

      const cfg = loadConfig();
      const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

      if (isHeadless()) {
        writeJsonSuccess({ txHash, explorerUrl, token: tokenAddr, spender: spenderAddr });
      } else {
        successBox(
          "Approval Revoked",
          `Token: ${colors.address(tokenAddr)}\n` +
            `Spender: ${options.spender}\n` +
            `Tx: ${colors.info(txHash)}`
        );
      }
    });

  return allowance;
}
