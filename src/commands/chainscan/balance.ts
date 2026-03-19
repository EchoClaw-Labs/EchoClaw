import { Command } from "commander";
import { chainscanClient } from "../../chainscan/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors, formatAddress, printTable } from "../../utils/ui.js";
import { resolveAddress, parseCommaSeparated, parseIntOpt, formatWei, formatTimestamp } from "./helpers.js";

export function createBalanceSubcommand(): Command {
  const balance = new Command("balance")
    .description("Get native 0G balance for an address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .option("--tag <tag>", "Block tag", "latest_state")
    .action(async (address: string | undefined, opts: { tag: string }) => {
      const addr = resolveAddress(address);
      const spin = spinner("Fetching balance...");
      spin.start();
      const bal = await chainscanClient.getBalance(addr, opts.tag);
      spin.succeed("Balance fetched");
      const formatted = formatWei(bal);
      respond({
        data: { address: addr, balance: bal, balanceFormatted: `${formatted} 0G` },
        ui: {
          type: "success",
          title: "Balance",
          body: `${colors.address(formatAddress(addr))}\n${colors.value(formatted)} 0G`,
        },
      });
    });

  return balance;
}

export function createBalanceMultiSubcommand(): Command {
  const balancemulti = new Command("balancemulti")
    .description("Get balances for multiple addresses")
    .requiredOption("--addresses <list>", "Comma-separated addresses", parseCommaSeparated)
    .option("--tag <tag>", "Block tag", "latest_state")
    .action(async (opts: { addresses: string[]; tag: string }) => {
      const spin = spinner("Fetching balances...");
      spin.start();
      const balances = await chainscanClient.getBalanceMulti(opts.addresses, opts.tag);
      spin.succeed("Balances fetched");

      if (isHeadless()) {
        writeJsonSuccess({ balances });
      } else {
        printTable(
          [{ header: "Address", width: 46 }, { header: "Balance (0G)", width: 22 }],
          balances.map(b => [b.account, formatWei(b.balance)])
        );
      }
    });

  return balancemulti;
}

export function createTokenBalanceSubcommand(): Command {
  const tokenBalance = new Command("token-balance")
    .description("Get ERC-20 token balance")
    .argument("<contractAddress>", "Token contract address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .action(async (contractAddress: string, address: string | undefined) => {
      const addr = resolveAddress(address);
      const spin = spinner("Fetching token balance...");
      spin.start();
      const bal = await chainscanClient.getTokenBalance(addr, contractAddress);
      spin.succeed("Token balance fetched");
      respond({
        data: { address: addr, contractAddress, balance: bal },
        ui: {
          type: "success",
          title: "Token Balance",
          body: `${colors.address(formatAddress(addr))}\nContract: ${colors.address(formatAddress(contractAddress))}\nBalance: ${colors.value(bal)}`,
        },
      });
    });

  return tokenBalance;
}

export function createTokenSupplySubcommand(): Command {
  const tokenSupply = new Command("token-supply")
    .description("Get total supply of an ERC-20 token")
    .argument("<contractAddress>", "Token contract address")
    .action(async (contractAddress: string) => {
      const spin = spinner("Fetching token supply...");
      spin.start();
      const supply = await chainscanClient.getTokenSupply(contractAddress);
      spin.succeed("Token supply fetched");
      respond({
        data: { contractAddress, totalSupply: supply },
        ui: {
          type: "success",
          title: "Token Supply",
          body: `Contract: ${colors.address(formatAddress(contractAddress))}\nTotal Supply: ${colors.value(supply)}`,
        },
      });
    });

  return tokenSupply;
}

export function createTxsSubcommand(): Command {
  const txs = new Command("txs")
    .description("List transactions for an address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .option("--page <n>", "Page number", parseIntOpt)
    .option("--offset <n>", "Results per page (max 100)", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .option("--startblock <n>", "Start block", parseIntOpt)
    .option("--endblock <n>", "End block", parseIntOpt)
    .action(async (address: string | undefined, opts: Record<string, unknown>) => {
      const addr = resolveAddress(address);
      const spin = spinner("Fetching transactions...");
      spin.start();
      const transactions = await chainscanClient.getTransactions(addr, opts as Record<string, number | string>);
      spin.succeed(`Found ${transactions.length} transaction(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ address: addr, count: transactions.length, transactions });
      } else {
        if (!transactions.length) {
          respond({ data: {}, ui: { type: "info", title: "Transactions", body: "No transactions found" } });
          return;
        }
        printTable(
          [
            { header: "Hash", width: 18 },
            { header: "From", width: 16 },
            { header: "To", width: 16 },
            { header: "Value (0G)", width: 16 },
            { header: "Time", width: 22 },
          ],
          transactions.map(tx => [
            formatAddress(tx.hash, 6),
            formatAddress(tx.from),
            formatAddress(tx.to || "(create)"),
            formatWei(tx.value),
            formatTimestamp(tx.timeStamp),
          ])
        );
      }
    });

  return txs;
}
