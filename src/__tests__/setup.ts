const BIGINT_BUFFER_FALLBACK_WARNING =
  "bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)";
const PUNYCODE_DEPRECATION_FRAGMENT = "The `punycode` module is deprecated.";

const originalConsoleWarn = console.warn.bind(console);
console.warn = ((first?: unknown, ...rest: unknown[]) => {
  if (typeof first === "string" && first.includes(BIGINT_BUFFER_FALLBACK_WARNING)) {
    return;
  }

  originalConsoleWarn(first, ...rest);
}) as typeof console.warn;

const originalEmitWarning = process.emitWarning.bind(process);

function extractWarningCode(args: unknown[]): string | undefined {
  const [typeOrOptions, code] = args;
  if (typeof code === "string") {
    return code;
  }

  if (
    typeOrOptions != null &&
    typeof typeOrOptions === "object" &&
    "code" in (typeOrOptions as Record<string, unknown>)
  ) {
    const value = (typeOrOptions as Record<string, unknown>).code;
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning?.message;
  const code = extractWarningCode(args);

  if (code === "DEP0040") {
    return;
  }

  if (typeof message === "string" && message.includes(PUNYCODE_DEPRECATION_FRAGMENT)) {
    return;
  }

  return (originalEmitWarning as (warning: string | Error, ...rest: unknown[]) => void)(
    warning,
    ...args,
  );
}) as typeof process.emitWarning;
