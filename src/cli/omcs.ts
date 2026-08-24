#!/usr/bin/env node

import { main } from "./index.js";

try {
	await main();
} catch {
	process.stderr.write("omcs: command failed safely\n");
	process.exitCode = 1;
}
