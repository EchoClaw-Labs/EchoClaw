import { afterEach, describe, expect, it } from "vitest";
import { AGENT_BUILD_COMPOSE_FILE, AGENT_COMPOSE_FILE, AgentComposeError, getAgentComposeArgs, getAgentComposeEnv, getAgentComposeFailureInfo, getAgentImage, getAgentPackageVersion } from "../../agent/compose.js";

const originalEnv = { ...process.env };

describe("agent compose helpers", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses platform-aware config dir and package-matched image by default", () => {
    delete process.env.ECHO_AGENT_IMAGE;
    delete process.env.ECHO_AGENT_IMAGE_REPOSITORY;
    delete process.env.ECHO_AGENT_IMAGE_TAG;
    delete process.env.ECHO_CONFIG_DIR;

    const env = getAgentComposeEnv();

    expect(env.ECHO_CONFIG_DIR).toBeTruthy();
    expect(env.ECHO_AGENT_IMAGE).toBe(`ghcr.io/desu777/echoclaw/echo-agent:${getAgentPackageVersion()}`);
  });

  it("prefers explicit image override", () => {
    process.env.ECHO_AGENT_IMAGE = "ghcr.io/example/custom-agent:test";

    expect(getAgentImage()).toBe("ghcr.io/example/custom-agent:test");
    expect(getAgentComposeEnv().ECHO_AGENT_IMAGE).toBe("ghcr.io/example/custom-agent:test");
  });

  it("builds compose args with optional local build override", () => {
    const baseArgs = getAgentComposeArgs(["up", "-d"]);
    const localArgs = getAgentComposeArgs(["up", "-d", "--build"], { includeBuildOverride: true });

    expect(baseArgs).toEqual(["compose", "-f", AGENT_COMPOSE_FILE, "-p", "echo-agent", "up", "-d"]);
    expect(localArgs).toEqual([
      "compose",
      "-f",
      AGENT_COMPOSE_FILE,
      "-f",
      AGENT_BUILD_COMPOSE_FILE,
      "-p",
      "echo-agent",
      "up",
      "-d",
      "--build",
    ]);
  });

  it("maps default-image GHCR denial to a release-specific message", () => {
    delete process.env.ECHO_AGENT_IMAGE;
    delete process.env.ECHO_AGENT_IMAGE_REPOSITORY;
    delete process.env.ECHO_AGENT_IMAGE_TAG;

    const failure = getAgentComposeFailureInfo(
      new AgentComposeError(
        "Docker compose failed.",
        `Image ghcr.io/desu777/echoclaw/echo-agent:${getAgentPackageVersion()} Error error from registry: denied`,
      ),
      { defaultHint: "Is Docker running?" },
    );

    expect(failure.isReleaseIssue).toBe(true);
    expect(failure.message).toContain("not publicly available");
    expect(failure.hint).toContain("matching public GHCR image");
  });

  it("does not map explicit image overrides to a release-specific message", () => {
    process.env.ECHO_AGENT_IMAGE = "ghcr.io/example/custom-agent:test";

    const failure = getAgentComposeFailureInfo(
      new AgentComposeError("Docker compose failed.", "error from registry: denied"),
      { defaultHint: "Is Docker running?" },
    );

    expect(failure.isReleaseIssue).toBe(false);
    expect(failure.message).toContain("Docker compose failed");
    expect(failure.hint).toBe("Is Docker running?");
  });
});
