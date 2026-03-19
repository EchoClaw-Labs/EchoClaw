import { Command } from "commander";
import { chainscanClient } from "../../chainscan/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors, formatAddress, printTable } from "../../utils/ui.js";
import { parseCommaSeparated } from "./helpers.js";

export function createTxSubcommand(): Command {
  const tx = new Command("tx")
    .description("Transaction verification")
    .exitOverride();

  tx
    .command("status")
    .description("Check transaction execution status")
    .argument("<txHash>", "Transaction hash")
    .action(async (txHash: string) => {
      const spin = spinner("Checking tx status...");
      spin.start();
      const status = await chainscanClient.getTxStatus(txHash);
      spin.succeed("Status fetched");
      const isError = status.isError === "1";
      respond({
        data: { txHash, ...status },
        ui: {
          type: isError ? "warn" : "success",
          title: "Transaction Status",
          body: isError
            ? `${colors.error("Error")}: ${status.errDescription}`
            : `${colors.success("Success")} — No execution error`,
        },
      });
    });

  tx
    .command("receipt")
    .description("Check transaction receipt status")
    .argument("<txHash>", "Transaction hash")
    .action(async (txHash: string) => {
      const spin = spinner("Checking tx receipt...");
      spin.start();
      const receipt = await chainscanClient.getTxReceiptStatus(txHash);
      spin.succeed("Receipt fetched");
      const success = receipt.status === "1";
      respond({
        data: { txHash, ...receipt },
        ui: {
          type: success ? "success" : "warn",
          title: "Transaction Receipt",
          body: success
            ? `${colors.success("Confirmed")} — Transaction succeeded`
            : `${colors.error("Failed")} — Transaction reverted`,
        },
      });
    });

  return tx;
}

export function createContractSubcommand(): Command {
  const contract = new Command("contract")
    .description("Contract intelligence")
    .exitOverride();

  contract
    .command("abi")
    .description("Get contract ABI (if verified)")
    .argument("<address>", "Contract address")
    .action(async (address: string) => {
      const spin = spinner("Fetching contract ABI...");
      spin.start();
      const abi = await chainscanClient.getContractAbi(address);
      spin.succeed("ABI fetched");
      respond({
        data: { address, abi },
        ui: {
          type: "success",
          title: "Contract ABI",
          body: `${colors.address(formatAddress(address))}\nABI length: ${abi.length} chars`,
        },
      });
    });

  contract
    .command("source")
    .description("Get contract source code (if verified)")
    .argument("<address>", "Contract address")
    .action(async (address: string) => {
      const spin = spinner("Fetching contract source...");
      spin.start();
      const sources = await chainscanClient.getContractSource(address);
      spin.succeed("Source fetched");

      if (isHeadless()) {
        writeJsonSuccess({ address, contracts: sources });
      } else {
        if (!sources.length || !sources[0].ContractName) {
          respond({ data: {}, ui: { type: "info", title: "Contract Source", body: "Contract not verified" } });
          return;
        }
        const s = sources[0];
        respond({
          data: {},
          ui: {
            type: "success",
            title: "Contract Source",
            body: [
              `Name: ${colors.bold(s.ContractName)}`,
              `Compiler: ${s.CompilerVersion}`,
              `Optimization: ${s.OptimizationUsed === "1" ? `Yes (${s.Runs} runs)` : "No"}`,
              `EVM: ${s.EVMVersion}`,
              `License: ${s.LicenseType}`,
              s.Proxy === "1" ? `Proxy → ${colors.address(s.Implementation)}` : null,
            ].filter(Boolean).join("\n"),
          },
        });
      }
    });

  contract
    .command("creation")
    .description("Get contract creation info")
    .requiredOption("--addresses <list>", "Comma-separated contract addresses (max 5)", parseCommaSeparated)
    .action(async (opts: { addresses: string[] }) => {
      const spin = spinner("Fetching contract creation info...");
      spin.start();
      const results = await chainscanClient.getContractCreation(opts.addresses);
      spin.succeed("Creation info fetched");

      if (isHeadless()) {
        writeJsonSuccess({ contracts: results });
      } else {
        if (!results.length) {
          respond({ data: {}, ui: { type: "info", title: "Contract Creation", body: "No results found" } });
          return;
        }
        printTable(
          [
            { header: "Contract", width: 16 },
            { header: "Creator", width: 16 },
            { header: "Tx Hash", width: 18 },
            { header: "Block", width: 10 },
          ],
          results.map(c => [
            formatAddress(c.contractAddress),
            formatAddress(c.contractCreator),
            formatAddress(c.txHash, 6),
            c.blockNumber,
          ])
        );
      }
    });

  return contract;
}

export function createDecodeSubcommand(): Command {
  const decode = new Command("decode")
    .description("Decode transaction data")
    .exitOverride();

  decode
    .command("hashes")
    .description("Decode method signatures by tx hashes (max 10)")
    .requiredOption("--hashes <list>", "Comma-separated tx hashes", parseCommaSeparated)
    .action(async (opts: { hashes: string[] }) => {
      const spin = spinner("Decoding method signatures...");
      spin.start();
      const results = await chainscanClient.decodeByHashes(opts.hashes);
      spin.succeed("Decoded");

      if (isHeadless()) {
        writeJsonSuccess({ decoded: results });
      } else {
        printTable(
          [
            { header: "Hash", width: 18 },
            { header: "ABI", width: 30 },
            { header: "Error", width: 20 },
          ],
          results.map(d => [
            formatAddress(d.hash, 6),
            d.abi || "-",
            d.error || "-",
          ])
        );
      }
    });

  decode
    .command("raw")
    .description("Decode raw input data against contracts (max 10)")
    .requiredOption("--contracts <list>", "Comma-separated contract addresses", parseCommaSeparated)
    .requiredOption("--inputs <list>", "Comma-separated input data (hex)", parseCommaSeparated)
    .action(async (opts: { contracts: string[]; inputs: string[] }) => {
      const spin = spinner("Decoding raw input...");
      spin.start();
      const results = await chainscanClient.decodeRaw(opts.contracts, opts.inputs);
      spin.succeed("Decoded");

      if (isHeadless()) {
        writeJsonSuccess({ decoded: results });
      } else {
        printTable(
          [
            { header: "Contract", width: 16 },
            { header: "ABI", width: 30 },
            { header: "Error", width: 20 },
          ],
          results.map(d => [
            formatAddress(d.contract),
            d.abi || "-",
            d.error || "-",
          ])
        );
      }
    });

  return decode;
}
