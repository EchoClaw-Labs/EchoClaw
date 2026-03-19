import { Command } from "commander";
import { io, Socket } from "socket.io-client";
import { loadConfig } from "../../config/store.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { requireSlopAuth } from "../../slop/auth.js";

export function createChatSubcommand(): Command {
  const chat = new Command("chat")
    .description("Global chat operations")
    .exitOverride();

  chat
    .command("post")
    .description("Post a message to global chat")
    .requiredOption("--message <text>", "Message content")
    .option("--gif <url>", "GIF URL")
    .action(async (options: { message: string; gif?: string }) => {
      if (!options.message || !options.message.trim()) {
        throw new EchoError(ErrorCodes.CHAT_MESSAGE_EMPTY, "Message cannot be empty");
      }

      if (options.message.length > 500) {
        throw new EchoError(ErrorCodes.CHAT_MESSAGE_TOO_LONG, "Message too long (max 500 characters)");
      }

      const { address, privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const spin = spinner("Authenticating...");
      spin.start();

      // 1. Get JWT access token
      const accessToken = await requireSlopAuth(
        privateKey,
        address,
        cfg.services.backendApiUrl
      );

      spin.text = "Connecting to chat...";

      // Socket.IO promise wrapper
      const postMessage = (): Promise<{ messageId: string; timestamp: number }> => {
        return new Promise((resolve, reject) => {
          const socket: Socket = io(cfg.services.chatWsUrl, {
            transports: ["websocket"],
            timeout: 30000,
          });

          let authenticated = false;
          const timeoutHandle = setTimeout(() => {
            socket.disconnect();
            reject(new EchoError(ErrorCodes.HTTP_TIMEOUT, "Chat connection timed out"));
          }, 60000);

          socket.on("connect", () => {
            spin.text = "Authenticating with JWT...";
            socket.emit("chat:auth", { accessToken });
          });

          socket.on("chat:auth_ok", (data: { sessionToken: string }) => {
            authenticated = true;
            spin.text = "Sending message...";
            socket.emit("chat:send", {
              content: options.message.trim(),
              gifUrl: options.gif || null,
            });
          });

          socket.on("chat:auth_failed", (data: { error: string; code?: string }) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            reject(new EchoError(ErrorCodes.CHAT_NOT_AUTHENTICATED, data.error || "Authentication failed"));
          });

          socket.on("chat:new", (msg: { id: string; senderAddress: string | null; content: string; timestamp: number }) => {
            // Wait for our own message echo
            if (authenticated && msg.senderAddress?.toLowerCase() === address.toLowerCase() && msg.content === options.message.trim()) {
              clearTimeout(timeoutHandle);
              socket.disconnect();
              resolve({ messageId: msg.id, timestamp: msg.timestamp });
            }
          });

          socket.on("chat:error", (data: { error: string; code?: string }) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, data.error || "Chat error"));
          });

          socket.on("connect_error", (err: Error) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            reject(new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, `Connection failed: ${err.message}`));
          });

          socket.on("disconnect", (reason: string) => {
            if (!authenticated) {
              clearTimeout(timeoutHandle);
              reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, `Disconnected: ${reason}`));
            }
          });
        });
      };

      try {
        const result = await postMessage();
        spin.succeed("Message posted");

        if (isHeadless()) {
          writeJsonSuccess({
            messageId: result.messageId,
            timestamp: result.timestamp,
            content: options.message.trim(),
          });
        } else {
          successBox(
            "Message Posted",
            `ID: ${colors.info(result.messageId)}\n` +
              `Content: ${options.message.trim().substring(0, 50)}${options.message.length > 50 ? "..." : ""}`
          );
        }
      } catch (err) {
        spin.fail("Failed to post message");
        throw err;
      }
    });

  chat
    .command("read")
    .description("Read recent chat messages (no auth required)")
    .option("--limit <n>", "Number of messages (1-250, default: server default 25)")
    .action(async (options: { limit?: string }) => {
      const cfg = loadConfig();

      // Parse and validate limit
      let limitNum: number | undefined;
      if (options.limit) {
        limitNum = parseInt(options.limit, 10);
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 250) {
          throw new EchoError(ErrorCodes.CHAT_SEND_FAILED, "Limit must be 1-250");
        }
      }

      const spin = spinner("Connecting to chat...");
      spin.start();

      const readHistory = (): Promise<Record<string, unknown>[]> => {
        return new Promise((resolve, reject) => {
          const query: Record<string, string> = {};
          if (limitNum) query.historyLimit = String(limitNum);

          const socket: Socket = io(cfg.services.chatWsUrl, {
            transports: ["websocket"],
            timeout: 15000,
            query,
          });

          const timeoutHandle = setTimeout(() => {
            socket.disconnect();
            reject(new EchoError(ErrorCodes.HTTP_TIMEOUT, "Chat history request timed out"));
          }, 15000);

          socket.on("chat:history", (messages: Record<string, unknown>[]) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            resolve(messages);
          });

          socket.on("connect_error", (err: Error) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            reject(new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, `Connection failed: ${err.message}`));
          });

          socket.on("chat:error", (data: { error: string }) => {
            clearTimeout(timeoutHandle);
            socket.disconnect();
            reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, data.error || "Chat error"));
          });
        });
      };

      try {
        const messages = await readHistory();
        spin.succeed(`Received ${messages.length} messages`);

        if (isHeadless()) {
          writeJsonSuccess({
            count: messages.length,
            messages,
          });
        } else {
          if (messages.length === 0) {
            infoBox("Chat", "No messages.");
          } else {
            for (const msg of messages) {
              const sender = msg.senderDisplayName || msg.senderAddress || "unknown";
              const time = msg.timestamp ? new Date(msg.timestamp as number).toLocaleTimeString() : "";
              const content = String(msg.content || "");
              const badge = msg.isAgent ? " [BOT]" : msg.senderIsEchoBot ? " [ECHO]" : "";
              console.log(`${colors.muted(time)} ${colors.info(String(sender))}${badge}: ${content}`);
            }
          }
        }
      } catch (err) {
        spin.fail("Failed to read chat history");
        throw err;
      }
    });

  return chat;
}
