import { Command } from "commander";
import { isAddress, getAddress, type Address } from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess, writeStderr } from "../../utils/output.js";
import { spinner, infoBox, colors, createTable } from "../../utils/ui.js";
import { SLOP_REGISTRY_ABI } from "../../slop/abi/registry.js";

export function createTokensSubcommand(): Command {
  const tokens = new Command("tokens")
    .description("List tokens")
    .exitOverride();

  tokens
    .command("mine")
    .description("List tokens created by a specific address")
    .option("--creator <address>", "Creator address (default: wallet from config)")
    .action(async (options: { creator?: string }) => {
      const cfg = loadConfig();
      const client = getPublicClient();

      let creatorAddr: Address;
      if (options.creator) {
        if (!isAddress(options.creator)) {
          throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${options.creator}`);
        }
        creatorAddr = getAddress(options.creator);
      } else if (cfg.wallet.address) {
        creatorAddr = cfg.wallet.address;
      } else {
        throw new EchoError(
          ErrorCodes.WALLET_NOT_CONFIGURED,
          "No creator specified and no wallet configured",
          "Use --creator <address> or configure a wallet"
        );
      }

      const spin = spinner("Fetching tokens...");
      spin.start();

      const tokenAddresses = await client.readContract({
        address: cfg.slop.tokenRegistry,
        abi: SLOP_REGISTRY_ABI,
        functionName: "getCreatorTokens",
        args: [creatorAddr],
      });

      if (tokenAddresses.length === 0) {
        spin.succeed("No tokens found");
        if (isHeadless()) {
          writeJsonSuccess({ creator: creatorAddr, tokens: [], count: 0, truncated: false });
        } else {
          infoBox("Creator Tokens", `No tokens found for ${colors.address(creatorAddr)}`);
        }
        return;
      }

      // Fetch token info
      const tokenInfos = await client.readContract({
        address: cfg.slop.tokenRegistry,
        abi: SLOP_REGISTRY_ABI,
        functionName: "getTokensInfo",
        args: [tokenAddresses as Address[]],
      });

      spin.succeed(`Found ${tokenAddresses.length} tokens`);

      const tokensData = tokenAddresses.map((addr, i) => ({
        address: addr,
        name: tokenInfos[i].name,
        symbol: tokenInfos[i].symbol,
        createdAt: tokenInfos[i].createdAt.toString(),
        isGraduated: tokenInfos[i].isGraduated,
      }));

      const count = await client.readContract({
        address: cfg.slop.tokenRegistry,
        abi: SLOP_REGISTRY_ABI,
        functionName: "creatorTokenCount",
        args: [creatorAddr],
      });

      const truncated = Number(count) > 100;

      if (isHeadless()) {
        writeJsonSuccess({
          creator: creatorAddr,
          tokens: tokensData,
          count: tokensData.length,
          truncated,
        });
      } else {
        const table = createTable([
          { header: "Symbol", width: 12 },
          { header: "Name", width: 20 },
          { header: "Address", width: 45 },
          { header: "Status", width: 12 },
        ]);

        for (const t of tokensData) {
          table.push([
            t.symbol,
            t.name.slice(0, 18),
            t.address,
            t.isGraduated ? colors.success("Graduated") : colors.info("Active"),
          ]);
        }

        writeStderr(table.toString());
        if (truncated) {
          writeStderr(colors.muted(`\nShowing first 100 of ${count} tokens`));
        }
      }
    });

  return tokens;
}
