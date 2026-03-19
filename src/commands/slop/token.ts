import { Command } from "commander";
import { randomBytes } from "node:crypto";
import {
  isAddress,
  getAddress,
  formatUnits,
  type Address,
  type Hex,
  decodeEventLog,
} from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors, formatBalance } from "../../utils/ui.js";
import { SLOP_FACTORY_ABI } from "../../slop/abi/factory.js";
import { SLOP_TOKEN_ABI } from "../../slop/abi/token.js";
import { calculateGraduationProgress } from "../../slop/quote.js";
import { validateUserSalt, validateOfficialToken, getTokenState } from "./helpers.js";

export function createTokenSubcommand(): Command {
  const token = new Command("token")
    .description("Token management")
    .exitOverride();

  token
    .command("create")
    .description("Create a new bonding curve token")
    .requiredOption("--name <name>", "Token name")
    .requiredOption("--symbol <symbol>", "Token symbol")
    .option("--description <text>", "Token description", "")
    .option("--image-url <url>", "Token image URL", "")
    .option("--twitter <handle>", "Twitter handle", "")
    .option("--telegram <handle>", "Telegram handle", "")
    .option("--website <url>", "Website URL", "")
    .option("--user-salt <hex>", "User-provided salt (32 bytes hex, default: random)")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (options: {
      name: string;
      symbol: string;
      description: string;
      imageUrl: string;
      twitter: string;
      telegram: string;
      website: string;
      userSalt?: string;
      yes: boolean;
    }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const { privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      // Generate or validate userSalt
      let userSalt: Hex;
      if (options.userSalt) {
        userSalt = validateUserSalt(options.userSalt);
      } else {
        userSalt = `0x${randomBytes(32).toString("hex")}` as Hex;
      }

      const spin = spinner("Creating token...");
      spin.start();

      const walletClient = getSigningClient(privateKey);
      const publicClient = getPublicClient();

      try {
        const txHash = await walletClient.writeContract({
          address: cfg.slop.factory,
          abi: SLOP_FACTORY_ABI,
          functionName: "createToken",
          args: [
            options.name,
            options.symbol,
            options.description,
            options.imageUrl,
            options.twitter,
            options.telegram,
            options.website,
            userSalt,
          ],
        });

        spin.text = "Waiting for confirmation...";

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        // Decode TokenCreated event (filter by factory address for safety)
        let tokenAddress: Address | undefined;
        let tokenId: bigint | undefined;

        for (const log of receipt.logs) {
          // Only process logs from the factory contract
          if (log.address.toLowerCase() !== cfg.slop.factory.toLowerCase()) {
            continue;
          }
          try {
            const decoded = decodeEventLog({
              abi: SLOP_FACTORY_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "TokenCreated") {
              tokenAddress = decoded.args.tokenAddress as Address;
              tokenId = decoded.args.tokenId as bigint;
              break;
            }
          } catch {
            // Not a TokenCreated event
          }
        }

        if (!tokenAddress) {
          throw new EchoError(ErrorCodes.SLOP_CREATE_FAILED, "Failed to decode TokenCreated event from receipt");
        }

        spin.succeed("Token created");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({
            txHash,
            explorerUrl,
            tokenAddress,
            tokenId: tokenId?.toString(),
            creator: walletClient.account.address,
            name: options.name,
            symbol: options.symbol,
          });
        } else {
          successBox(
            "Token Created",
            `Name: ${colors.info(options.name)}\n` +
              `Symbol: ${colors.info(options.symbol)}\n` +
              `Address: ${colors.address(tokenAddress)}\n` +
              `Token ID: ${tokenId?.toString()}\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Token creation failed");
        if (err instanceof EchoError) throw err;
        throw new EchoError(
          ErrorCodes.SLOP_CREATE_FAILED,
          `Token creation failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  token
    .command("info <token>")
    .description("Show token information")
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const client = getPublicClient();
      const cfg = loadConfig();

      const spin = spinner("Fetching token info...");
      spin.start();

      const [
        name,
        symbol,
        metadata,
        creator,
        creationTime,
        state,
        tradeInfo,
        [price, priceSource],
      ] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "name" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "metadata" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "creator" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "creationTime" }),
        getTokenState(tokenAddr),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "tradeInfo" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
      ]);

      const graduationProgress = calculateGraduationProgress(
        state.tokenReserves,
        state.virtualTokenReserves,
        state.curveSupply
      );

      spin.succeed("Token info loaded");

      const priceSourceStr = priceSource === 0 ? "bonding" : "pool";

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          name,
          symbol,
          creator,
          creationTime: creationTime.toString(),
          isGraduated: state.isGraduated,
          price: price.toString(),
          priceSource: priceSourceStr,
          priceFormatted: formatUnits(price, 18),
          graduationProgressBps: graduationProgress.toString(),
          graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
          reserves: {
            og: state.ogReserves.toString(),
            token: state.tokenReserves.toString(),
            virtualOg: state.virtualOgReserves.toString(),
            virtualToken: state.virtualTokenReserves.toString(),
          },
          fees: {
            buyBps: Number(state.buyFeeBps),
            sellBps: Number(state.sellFeeBps),
          },
          tradeInfo: {
            totalVolume: tradeInfo[0].toString(),
            totalTransactions: tradeInfo[1].toString(),
            buyCount: tradeInfo[2].toString(),
            sellCount: tradeInfo[3].toString(),
            uniqueTraders: tradeInfo[4].toString(),
          },
          metadata: {
            description: metadata[0],
            imageUrl: metadata[1],
            twitter: metadata[2],
            telegram: metadata[3],
            website: metadata[4],
          },
        });
      } else {
        const statusStr = state.isGraduated
          ? colors.success("Graduated")
          : `${colors.info("Active")} (${(Number(graduationProgress) / 100).toFixed(2)}% to graduation)`;

        infoBox(
          `${name} (${symbol})`,
          `Address: ${colors.address(tokenAddr)}\n` +
            `Creator: ${colors.address(creator)}\n` +
            `Status: ${statusStr}\n` +
            `Price: ${colors.value(formatUnits(price, 18))} 0G (${priceSourceStr})\n` +
            `Buy Fee: ${(Number(state.buyFeeBps) / 100).toFixed(2)}%\n` +
            `Sell Fee: ${(Number(state.sellFeeBps) / 100).toFixed(2)}%\n` +
            `Trades: ${tradeInfo[1].toString()} (${tradeInfo[4].toString()} unique traders)\n` +
            `Volume: ${colors.value(formatBalance(tradeInfo[0], 18))} 0G`
        );
      }
    });

  return token;
}
