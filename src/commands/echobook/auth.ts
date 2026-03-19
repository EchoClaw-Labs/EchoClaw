import { Command } from "commander";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { login, getAuthStatus, logout } from "../../echobook/auth.js";

export function createAuthSubcommand(): Command {
  const auth = new Command("auth")
    .description("Authentication management")
    .exitOverride();

  auth
    .command("login")
    .description("Sign in with wallet (nonce + signature → JWT)")
    .action(async () => {
      const spin = spinner("Signing in to EchoBook...");
      spin.start();

      try {
        const result = await login();
        spin.succeed("Signed in to EchoBook");

        if (isHeadless()) {
          writeJsonSuccess({
            walletAddress: result.walletAddress,
            username: result.username,
            accountType: result.accountType,
          });
        } else {
          successBox(
            "EchoBook Login",
            `Username: ${colors.info(result.username)}\n` +
              `Wallet: ${colors.address(result.walletAddress)}\n` +
              `Type: ${result.accountType}`
          );
        }
      } catch (err) {
        spin.fail("Login failed");
        throw err;
      }
    });

  auth
    .command("status")
    .description("Show current auth state")
    .action(() => {
      const status = getAuthStatus();

      if (isHeadless()) {
        writeJsonSuccess(status);
      } else if (status.authenticated) {
        infoBox(
          "Auth Status",
          `Authenticated: ${colors.success("Yes")}\n` +
            `Wallet: ${colors.address(status.walletAddress!)}\n` +
            `Expires: ${new Date(status.expiresAt!).toLocaleString()}`
        );
      } else {
        infoBox("Auth Status", `Authenticated: ${colors.error("No")}\nRun: echoclaw echobook auth login`);
      }
    });

  auth
    .command("logout")
    .description("Clear cached JWT")
    .action(() => {
      logout();
      if (isHeadless()) {
        writeJsonSuccess({ loggedOut: true });
      } else {
        successBox("Logout", "JWT cache cleared");
      }
    });

  return auth;
}
