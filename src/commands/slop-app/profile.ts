import { Command } from "commander";
import { loadConfig } from "../../config/store.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { fetchJson } from "../../utils/http.js";
import { requireSlopAuth } from "../../slop/auth.js";
import type { ApiResponse, ProfileResponse } from "./index.js";

export function createProfileSubcommand(): Command {
  const profile = new Command("profile")
    .description("Profile management")
    .exitOverride();

  profile
    .command("nonce")
    .description("[Deprecated] Nonce endpoint removed — auth uses JWT now")
    .action(async () => {
      throw new EchoError(
        ErrorCodes.SLOP_AUTH_FAILED,
        "Profile nonce endpoint has been removed. Auth now uses JWT tokens.",
        "Use 'echoclaw slop-app profile register' which handles auth automatically"
      );
    });

  profile
    .command("register")
    .description("Register agent profile")
    .requiredOption("--username <name>", "Username (3-15 chars, alphanumeric + underscore)")
    .option("--twitter <url>", "X.com URL (https://x.com/username)")
    .option("--avatar-cid <cid>", "IPFS CID from image upload")
    .option("--avatar-gateway <url>", "Gateway URL from image upload")
    .requiredOption("--yes", "Confirm registration")
    .action(async (options: { username: string; twitter?: string; avatarCid?: string; avatarGateway?: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      // Validate username
      if (!/^[a-zA-Z0-9_]{3,15}$/.test(options.username)) {
        throw new EchoError(
          ErrorCodes.INVALID_USERNAME,
          "Username must be 3-15 characters, alphanumeric and underscore only"
        );
      }

      // Validate Twitter URL if provided
      if (options.twitter && !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(options.twitter)) {
        throw new EchoError(
          ErrorCodes.INVALID_USERNAME,
          "Invalid X.com URL format. Must be https://x.com/username"
        );
      }

      // Validate avatar flags: both must be provided together
      if ((options.avatarCid && !options.avatarGateway) || (!options.avatarCid && options.avatarGateway)) {
        throw new EchoError(
          ErrorCodes.REGISTRATION_FAILED,
          "Both --avatar-cid and --avatar-gateway are required together. Use 'echoclaw slop-app image upload' to get both values."
        );
      }

      const { address, privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const spin = spinner("Registering profile...");
      spin.start();

      try {
        // 1. Authenticate (JWT)
        spin.text = "Authenticating...";
        const accessToken = await requireSlopAuth(
          privateKey,
          address,
          cfg.services.backendApiUrl
        );

        // 2. Register with isEchoBot=true (Bearer auth)
        spin.text = "Registering profile...";
        const registerResponse = await fetchJson<ApiResponse<ProfileResponse>>(
          `${cfg.services.backendApiUrl}/profiles/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              username: options.username,
              twitterUrl: options.twitter || null,
              avatarCid: options.avatarCid || null,
              avatarGateway: options.avatarGateway || null,
              avatarIpfs: options.avatarCid ? `ipfs://${options.avatarCid}` : null,
              isEchoBot: true,
            }),
          }
        );

        if (!registerResponse.success || !registerResponse.data) {
          throw new EchoError(ErrorCodes.REGISTRATION_FAILED, registerResponse.error || "Registration failed");
        }

        spin.succeed("Profile registered");

        const profileData = registerResponse.data;

        if (isHeadless()) {
          writeJsonSuccess({
            walletAddress: profileData.walletAddress,
            username: profileData.username,
            isEchoBot: true,
            avatarUrl: profileData.avatarUrl,
            twitterUrl: profileData.twitterUrl,
            createdAt: profileData.createdAt,
          });
        } else {
          successBox(
            "Profile Registered",
            `Username: ${colors.info(profileData.username)}\n` +
              `Wallet: ${colors.address(profileData.walletAddress)}\n` +
              `Badge: ${colors.success("(ECHO)")}\n` +
              (profileData.twitterUrl ? `Twitter: ${profileData.twitterUrl}\n` : "")
          );
        }
      } catch (err) {
        spin.fail("Registration failed");
        if (err instanceof EchoError) throw err;
        throw new EchoError(ErrorCodes.REGISTRATION_FAILED, `Registration failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  profile
    .command("show")
    .description("Show profile by address")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .action(async (addressArg?: string) => {
      const cfg = loadConfig();
      let targetAddress: string;

      if (addressArg) {
        targetAddress = addressArg;
      } else if (cfg.wallet.address) {
        targetAddress = cfg.wallet.address;
      } else {
        throw new EchoError(
          ErrorCodes.WALLET_NOT_CONFIGURED,
          "No address specified and no wallet configured",
          "Provide an address or configure a wallet"
        );
      }

      const spin = spinner("Fetching profile...");
      spin.start();

      try {
        const response = await fetchJson<ApiResponse<ProfileResponse>>(
          `${cfg.services.backendApiUrl}/profiles/${targetAddress}`
        );

        if (!response.success || !response.data) {
          throw new EchoError(ErrorCodes.PROFILE_NOT_FOUND, response.error || "Profile not found");
        }

        spin.succeed("Profile loaded");

        const profile = response.data;

        if (isHeadless()) {
          writeJsonSuccess({
            walletAddress: profile.walletAddress,
            username: profile.username,
            isEchoBot: profile.isEchoBot || false,
            avatarUrl: profile.avatarUrl,
            twitterUrl: profile.twitterUrl,
            createdAt: profile.createdAt,
          });
        } else {
          const badgeStr = profile.isEchoBot ? ` ${colors.success("(ECHO)")}` : "";
          infoBox(
            `${profile.username}${badgeStr}`,
            `Wallet: ${colors.address(profile.walletAddress)}\n` +
              (profile.avatarUrl ? `Avatar: ${profile.avatarUrl}\n` : "") +
              (profile.twitterUrl ? `Twitter: ${profile.twitterUrl}\n` : "") +
              `Created: ${new Date(profile.createdAt).toLocaleString()}`
          );
        }
      } catch (err) {
        spin.fail("Failed to fetch profile");
        if (err instanceof EchoError) throw err;
        throw new EchoError(ErrorCodes.PROFILE_NOT_FOUND, `Profile fetch failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  return profile;
}
