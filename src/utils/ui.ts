import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import ora, { type Ora } from "ora";
import figlet from "figlet";
import { writeStderr, isHeadless } from "./output.js";

/**
 * Noop spinner for headless mode - implements same interface as Ora
 */
interface NoopSpinner {
  start: () => NoopSpinner;
  succeed: (text?: string) => NoopSpinner;
  fail: (text?: string) => NoopSpinner;
  warn: (text?: string) => NoopSpinner;
  stop: () => NoopSpinner;
  text: string;
}

export function printLogo(): void {
  const logo = figlet.textSync("EchoClaw", {
    font: "Standard",
    horizontalLayout: "default",
  });

  writeStderr(chalk.whiteBright(logo));
  writeStderr(chalk.whiteBright(" EchoClaw") + chalk.blueBright(" • ") + chalk.blue("0G Network"));
  writeStderr("");
}

export function spinner(text: string): Ora | NoopSpinner {
  if (isHeadless()) {
    const noop: NoopSpinner = {
      start: () => noop,
      succeed: () => noop,
      fail: () => noop,
      warn: () => noop,
      stop: () => noop,
      text: "",
    };
    return noop;
  }
  return ora({
    text,
    color: "blue",
    spinner: "dots",
  });
}

export function successBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr(
    boxen(content, {
      title: chalk.blueBright(`✓ ${title}`),
      titleAlignment: "left",
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "blue",
      borderStyle: "round",
    })
  );
}

export function errorBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr(
    boxen(content, {
      title: chalk.red(`✗ ${title}`),
      titleAlignment: "left",
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "red",
      borderStyle: "round",
    })
  );
}

export function infoBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr(
    boxen(content, {
      title: chalk.blueBright(`ℹ ${title}`),
      titleAlignment: "left",
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "blue",
      borderStyle: "round",
    })
  );
}

export function warnBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr(
    boxen(content, {
      title: chalk.blueBright(`! ${title}`),
      titleAlignment: "left",
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "blue",
      borderStyle: "round",
    })
  );
}

export interface TableColumn {
  header: string;
  width?: number;
}

export function createTable(columns: TableColumn[]): Table.Table {
  return new Table({
    head: columns.map((c) => chalk.blueBright(c.header)),
    colWidths: columns.map((c) => c.width ?? null),
    style: {
      head: [],
      border: ["gray"],
    },
  });
}

export function printTable(columns: TableColumn[], rows: string[][]): void {
  const table = createTable(columns);
  rows.forEach((row) => table.push(row));
  writeStderr(table.toString());
}

export function formatAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatBalance(value: bigint, decimals: number, precision = 4): string {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0").slice(0, precision);

  // Remove trailing zeros
  const trimmedFractional = fractionalStr.replace(/0+$/, "");

  if (trimmedFractional === "") {
    return integerPart.toLocaleString();
  }

  return `${integerPart.toLocaleString()}.${trimmedFractional}`;
}

export const colors = {
  success: chalk.blueBright,
  error: chalk.red,
  warn: chalk.blue,
  info: chalk.blueBright,
  muted: chalk.gray,
  bold: chalk.bold,
  address: chalk.blue,
  value: chalk.whiteBright,
};
