import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Original OMCS release isolation boundary. No host credentials or arbitrary variables cross it. */
export async function buildReleaseEnvironment(
	source: NodeJS.ProcessEnv,
	isolatedRoot: string,
	nodeExecutable: string,
): Promise<NodeJS.ProcessEnv> {
	const nodeDirectory = dirname(await realpath(nodeExecutable));
	const path = [...new Set([nodeDirectory, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
	return {
		HOME: join(isolatedRoot, "home"),
		CODEX_HOME: join(isolatedRoot, "codex-home"),
		TMPDIR: join(isolatedRoot, "tmp"),
		PATH: path,
		LANG: source.LANG ?? "C",
		LC_ALL: source.LC_ALL ?? "C",
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "commit.gpgSign",
		GIT_CONFIG_VALUE_0: "false",
		npm_config_cache: join(isolatedRoot, "npm-cache"),
		npm_config_prefix: join(isolatedRoot, "npm-prefix"),
		npm_config_userconfig: join(isolatedRoot, "npmrc"),
		npm_config_offline: "true",
		npm_config_audit: "false",
		npm_config_fund: "false",
		npm_config_update_notifier: "false",
	};
}
