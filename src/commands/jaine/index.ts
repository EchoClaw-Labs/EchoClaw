import { Command } from "commander";
import { createTokensSubcommand } from "./tokens.js";
import { createPoolsSubcommand } from "./pools.js";
import { createW0gSubcommand } from "./w0g.js";
import { createAllowanceSubcommand } from "./allowance.js";
import { createSwapSubcommand } from "./swap.js";
import { createLpSubcommand } from "./lp.js";
import { createSubgraphSubcommand } from "./subgraph.js";

export function createJaineCommand(): Command {
  const jaine = new Command("jaine")
    .description("Jaine DEX operations (swap, LP, pools)")
    .exitOverride();

  jaine.addCommand(createTokensSubcommand());
  jaine.addCommand(createPoolsSubcommand());
  jaine.addCommand(createW0gSubcommand());
  jaine.addCommand(createAllowanceSubcommand());
  jaine.addCommand(createSwapSubcommand());
  jaine.addCommand(createLpSubcommand());
  jaine.addCommand(createSubgraphSubcommand());

  return jaine;
}
