import { Command } from "commander";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, colors } from "../../utils/ui.js";
import { fetchJson, fetchWithTimeout } from "../../utils/http.js";
import type { ImageUploadResponse, ImageGenerateResponse } from "./index.js";

export function createImageSubcommand(): Command {
  const image = new Command("image")
    .description("Image upload and generation")
    .exitOverride();

  image
    .command("upload")
    .description("Upload image to IPFS via proxy")
    .requiredOption("--file <path>", "Path to image file")
    .action(async (options: { file: string }) => {
      const cfg = loadConfig();

      // Read file
      let fileBuffer: Buffer;
      let filename: string;
      try {
        fileBuffer = readFileSync(options.file);
        filename = basename(options.file);
      } catch (err) {
        throw new EchoError(ErrorCodes.IMAGE_UPLOAD_FAILED, `Failed to read file: ${options.file}`);
      }

      // Check file size (5MB limit)
      if (fileBuffer.length > 5 * 1024 * 1024) {
        throw new EchoError(ErrorCodes.IMAGE_TOO_LARGE, "Image too large (max 5MB)");
      }

      // Detect mime type
      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
      };
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const mimeType = mimeTypes[ext];

      if (!mimeType) {
        throw new EchoError(ErrorCodes.IMAGE_INVALID_FORMAT, "Invalid image format. Allowed: jpg, jpeg, png, gif");
      }

      const spin = spinner("Uploading image...");
      spin.start();

      try {
        // Create FormData
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        formData.append("image", blob, filename);

        const response = await fetchWithTimeout(`${cfg.services.proxyApiUrl}/upload-image`, {
          method: "POST",
          body: formData,
        });

        const result = (await response.json()) as ImageUploadResponse;

        if (!result.success) {
          throw new EchoError(ErrorCodes.IMAGE_UPLOAD_FAILED, result.error || "Upload failed");
        }

        spin.succeed("Image uploaded");

        if (isHeadless()) {
          writeJsonSuccess({
            ipfsHash: result.ipfsHash,
            gatewayUrl: result.gatewayUrl,
            filename,
          });
        } else {
          successBox(
            "Image Uploaded",
            `File: ${filename}\n` +
              `IPFS Hash: ${colors.info(result.ipfsHash)}\n` +
              `Gateway URL: ${colors.muted(result.gatewayUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Upload failed");
        if (err instanceof EchoError) throw err;
        throw new EchoError(ErrorCodes.IMAGE_UPLOAD_FAILED, `Upload failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  image
    .command("generate")
    .description("Generate AI image from prompt")
    .requiredOption("--prompt <text>", "Image generation prompt")
    .option("--upload", "Upload generated image to IPFS")
    .action(async (options: { prompt: string; upload?: boolean }) => {
      const cfg = loadConfig();

      if (options.prompt.length > 1000) {
        throw new EchoError(ErrorCodes.IMAGE_GENERATION_FAILED, "Prompt too long (max 1000 characters)");
      }

      const spin = spinner("Generating image...");
      spin.start();

      try {
        const response = await fetchJson<ImageGenerateResponse>(
          `${cfg.services.proxyApiUrl}/generate-image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: options.prompt,
              uploadToIPFS: options.upload || false,
            }),
            timeoutMs: 120000, // 2 min for generation
          }
        );

        if (!response.success) {
          throw new EchoError(ErrorCodes.IMAGE_GENERATION_FAILED, response.error || "Generation failed");
        }

        spin.succeed("Image generated");

        if (isHeadless()) {
          writeJsonSuccess({
            imageUrl: response.imageUrl,
            ipfsHash: response.ipfsHash || null,
            gatewayUrl: response.gatewayUrl || null,
          });
        } else {
          const lines = [`Image URL: ${colors.muted(response.imageUrl || "N/A")}`];
          if (response.ipfsHash) {
            lines.push(`IPFS Hash: ${colors.info(response.ipfsHash)}`);
            lines.push(`Gateway: ${colors.muted(response.gatewayUrl || "")}`);
          }
          successBox("Image Generated", lines.join("\n"));
        }
      } catch (err) {
        spin.fail("Generation failed");
        if (err instanceof EchoError) throw err;
        throw new EchoError(ErrorCodes.IMAGE_GENERATION_FAILED, `Generation failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  return image;
}
