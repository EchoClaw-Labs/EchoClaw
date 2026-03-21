const AUTONOMOUS_LOOP_PROMPT = "You are in autonomous loop mode. Check portfolio balances, evaluate open positions, review market conditions. Take action if your strategies warrant it. Log any decisions to your trading journal.";

export function getAutonomousLoopPrompt(): string {
  return AUTONOMOUS_LOOP_PROMPT;
}

export function buildScheduledAlertPrompt(message: string): string {
  return `SCHEDULED ALERT CHECK: ${message}. Check if this condition is met and report.`;
}
