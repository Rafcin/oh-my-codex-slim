import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

interface ArmObservation {
	verified: boolean;
	durationMs: number;
	totalTokens?: number;
}

interface PairObservation {
	plain: ArmObservation;
	omcs: ArmObservation;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function wilson(successes: number, total: number): readonly [number, number] {
	const z = 1.959963984540054;
	const proportion = successes / total;
	const denominator = 1 + z ** 2 / total;
	const center = (proportion + z ** 2 / (2 * total)) / denominator;
	const half = z * Math.sqrt(proportion * (1 - proportion) / total + z ** 2 / (4 * total ** 2)) / denominator;
	return [center - half, center + half];
}

function seededRandom(): () => number {
	let state = 0x4f4d4353;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 4_294_967_296;
	};
}

function bootstrapInterval(
	pairs: readonly PairObservation[],
	statistic: (sample: readonly PairObservation[]) => number,
): readonly [number, number] {
	const random = seededRandom();
	const estimates: number[] = [];
	for (let repetition = 0; repetition < 100_000; repetition += 1) {
		const sample: PairObservation[] = [];
		for (let index = 0; index < pairs.length; index += 1) {
			sample.push(pairs[Math.floor(random() * pairs.length)] as PairObservation);
		}
		estimates.push(statistic(sample));
	}
	estimates.sort((left, right) => left - right);
	return [estimates[2_500] as number, estimates[97_500] as number];
}

function parsePairs(source: string): PairObservation[] {
	const [headerLine, ...lines] = source.trim().split("\n");
	const headers = headerLine?.split(",") ?? [];
	return lines.map((line) => {
		const fields = line.split(",");
		const row = Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ""]));
		const arm = (name: "plain" | "omcs"): ArmObservation => ({
			verified: row[`${name}_verified`] === "true",
			durationMs: Number(row[`${name}_duration_ms`]),
			...(row[`${name}_total_tokens`] === "" ? {} : { totalTokens: Number(row[`${name}_total_tokens`]) }),
		});
		return { plain: arm("plain"), omcs: arm("omcs") };
	});
}

describe("published benchmark mathematics", () => {
	it("recomputes every headline from the sanitized paired observations", async () => {
		const root = process.cwd();
		const pairs = parsePairs(await readFile(join(root, "docs", "benchmark-results", "prompt-refinement-pilot-2026-08-27.csv"), "utf8"));
		assert.equal(pairs.length, 18);
		assert.equal(pairs.filter((pair) => pair.plain.verified).length, 16);
		assert.equal(pairs.filter((pair) => pair.omcs.verified).length, 15);
		assert.deepEqual(wilson(16, 18).map((value) => Number((value * 100).toFixed(1))), [67.2, 96.9]);
		assert.deepEqual(wilson(15, 18).map((value) => Number((value * 100).toFixed(1))), [60.8, 94.2]);

		const improved = pairs.filter((pair) => !pair.plain.verified && pair.omcs.verified).length;
		const regressed = pairs.filter((pair) => pair.plain.verified && !pair.omcs.verified).length;
		assert.deepEqual({ improved, regressed }, { improved: 1, regressed: 2 });
		const delta = (improved - regressed) / pairs.length;
		assert.equal(Number((delta * 100).toFixed(1)), -5.6);

		const deltaInterval = bootstrapInterval(pairs, (sample) => sample.reduce(
			(total, pair) => total + Number(pair.omcs.verified) - Number(pair.plain.verified),
			0,
		) / sample.length);
		assert.deepEqual(deltaInterval.map((value) => Number((value * 100).toFixed(1))), [-22.2, 11.1]);

		assert.equal(median(pairs.map((pair) => pair.plain.durationMs)), 64_916.5);
		assert.equal(median(pairs.map((pair) => pair.omcs.durationMs)), 128_958);
		const timeInterval = bootstrapInterval(
			pairs,
			(sample) => median(sample.map((pair) => pair.omcs.durationMs)) / median(sample.map((pair) => pair.plain.durationMs)),
		);
		assert.deepEqual(timeInterval.map((value) => Number(value.toFixed(2))), [1.8, 2.49]);

		const complete = pairs.filter((pair) => pair.plain.totalTokens !== undefined && pair.omcs.totalTokens !== undefined);
		assert.equal(complete.length, 17);
		const tokenInterval = bootstrapInterval(
			complete,
			(sample) => median(sample.map((pair) => pair.omcs.totalTokens as number)) / median(sample.map((pair) => pair.plain.totalTokens as number)),
		);
		assert.deepEqual(tokenInterval.map((value) => Number(value.toFixed(2))), [2.63, 4.47]);

		const readme = await readFile(join(root, "README.md"), "utf8");
		const report = await readFile(join(root, "docs", "benchmark-results", "2026-08-27-prompt-refinement-pilot.md"), "utf8");
		const resultChart = await readFile(join(root, "docs", "assets", "omcs-benchmark-results.svg"), "utf8");
		for (const claim of ["16/18", "15/18", "−5.6 percentage points", "p = 1.000", "1.99× slower", "3.25×"]) {
			assert.ok(readme.includes(claim), `README claim: ${claim}`);
			assert.ok(report.includes(claim), `report claim: ${claim}`);
		}
		assert.match(resultChart, /complete-pair ratio 3\.25×/);
		assert.match(resultChart, /usage observed on 35 \/ 36 runs/);
	});
});
