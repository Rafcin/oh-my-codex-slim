# Prompt refinement pilot: Plain Codex versus OMCS auto

This is the first valid public OMCS comparison. It is a small CLI canary, not a leaderboard or a claim about every repository.

## Result

| Metric | Plain Codex | OMCS auto | Paired interpretation |
| --- | ---: | ---: | --- |
| Hidden-grader success | 16/18 (88.9%) | 15/18 (83.3%) | −5.6 percentage points |
| Wilson 95% interval | 67.2–96.9% | 60.8–94.2% | intervals overlap substantially |
| Median wall time | 64.9 s | 129.0 s | 1.99× slower; paired-bootstrap 95% interval 1.80–2.49× |
| Median total tokens | 87,432 (18/18 observed) | 279,975 (17/18 observed) | 3.25× on complete pairs; paired-bootstrap 95% interval 2.63–4.47× |
| Timed-out runs | 0/18 | 1/18 | OMCS configuration diagnosis timed out after 3,360.8 s |
| Safety violations | 0 | 0 | tied |

Paired outcomes were 1 improvement, 2 regressions, 14 tied passes, and 1 tied failure. The exact two-sided McNemar/binomial test over the three discordant pairs is `p = 1.000`. The paired success delta bootstrap interval is −22.2 to +11.1 percentage points. This matrix does not show an overall OMCS quality gain.

Total observed wall time was 25.7 minutes for Plain Codex and 100.5 minutes for OMCS, including the OMCS timeout. Those totals describe this run and are not normalized performance estimates.

## Mathematics

For arm `g`, hidden-grader success is

```text
p_g = (1 / n) Σᵢ Yᵢg,  where Yᵢg ∈ {0, 1} and n = 18.
Δ = p_OMCS − p_Plain = 15/18 − 16/18 = −1/18 = −5.56 percentage points.
```

Each arm's binomial interval is the 95% Wilson score interval:

```text
center = (p + z²/(2n)) / (1 + z²/n)
half   = z √(p(1−p)/n + z²/(4n²)) / (1 + z²/n),  z = 1.959964.
```

The paired exact test uses only discordant outcomes. With `b = 1` improvement and `c = 2` regressions, `b | (b+c) ~ Binomial(3, 0.5)` under the null. The exact two-sided result is `p = 1.000`.

Uncertainty for the success delta, median wall-time ratio, and complete-pair median-token ratio uses 100,000 percentile bootstrap resamples of whole task–repetition pairs with replacement. Each metric restarts xorshift32 with seed `0x4F4D4353`. The wall-time statistic retains the timeout duration. The token statistic excludes the one pair whose OMCS usage event was missing; it does not impute a value.

## Task results

| Task | Plain | OMCS | Plain median | OMCS median | What this run says |
| --- | ---: | ---: | ---: | ---: | --- |
| Query parser regression | 3/3 | 3/3 | 40.2 s · 71.4k tokens | 107.6 s · 255.7k | quality tie; OMCS slower and heavier |
| Inventory reservation feature | 3/3 | 3/3 | 55.0 s · 73.2k | 129.7 s · 338.2k | quality tie; OMCS slower and heavier |
| Artifact-path security | 3/3 | 3/3 | 60.7 s · 73.7k | 128.3 s · 268.3k | quality tie; no measured security gain |
| Configuration diagnosis | 3/3 | 2/3 | 81.4 s · 110.5k | 386.6 s · 438.2k observed | OMCS regression and one 56-minute timeout |
| Execution documentation | 1/3 | 1/3 | 64.7 s · 104.7k | 110.2 s · 277.2k | unstable for both; one improvement and one regression |
| Retry client feature | 3/3 | 3/3 | 68.9 s · 110.9k | 137.7 s · 286.1k | quality tie; OMCS slower and heavier |

OMCS did not win any task in aggregate. Its clearest current weakness is over-orchestration: five task families reached equal aggregate acceptance with higher median cost, and diagnosis regressed. The actionable tuning direction is to make `auto` default to a bounded fast/solo path for settled, narrow tasks; impose an orchestration wall-time/agent budget; and reserve multi-agent review for evidence-backed risk.

## Actual generated code

This query-parser implementation was produced by OMCS in a valid passing treatment run, not copied from the checked-in oracle:

```js
export function parseQuery(input) {
  const result = {};
  const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

  for (const [key, value] of new URLSearchParams(input.replace(/^\?/, ""))) {
    if (unsafeKeys.has(key)) continue;

    if (Object.hasOwn(result, key)) {
      result[key] = Array.isArray(result[key])
        ? [...result[key], value]
        : [result[key], value];
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

It added focused tests for percent decoding, `+` handling, repeated keys, missing values, and prototype-pollution keys; the hidden grader passed. Plain Codex also passed all three query-parser repetitions, so this is an example of acceptable OMCS output, not evidence of superiority.

## Scope and limitations

- The public fixtures, prompts, and graders are checked in. This is a prompt-refinement canary, not held-out evidence.
- Six tasks and three repetitions yield wide uncertainty. The exact paired test does not reject equal success.
- This is a Codex CLI activation benchmark. The OMCS skill activated in all 18 treatment transcripts and in none of the controls, but the isolated model PATH intentionally hid the `omcs` executable. At least two treatment transcripts explicitly reported specialist lanes unavailable. The run therefore measures OMCS skill/prompt routing in CLI, not the full Desktop multi-agent ceiling.
- One OMCS timeout has no completed usage event. Success and time keep that failure; token comparisons report 17/18 treatment coverage and use complete pairs only for the paired ratio.
- Two earlier matrices are excluded. The first could not read the treatment skill root. The second omitted the explicit `codex exec --sandbox workspace-write` flag and unfairly caused the control to self-report a read-only workspace. Neither contributes to any number here.

## Reproduction and provenance

The sanitized pair-level observations are in [prompt-refinement-pilot-2026-08-27.csv](prompt-refinement-pilot-2026-08-27.csv). Private transcripts and prompts remain ignored.

- results SHA-256: `9eddd9611ba163263d802de1d3754256faf833461331cb2003682fb419cb7eb3`
- frozen plan SHA-256: `c4a26f573619ef7d3d16359e5444507d3f488a4f08c42cde4f52bc9557c62430`
- benchmark harness SHA-256: `b431563c8cbea92be89288b01f7a1d6e0bca519fb1caf776510405c316d46cd5`
- suite SHA-256: `fc99c0178559600d349373805c34c5c3b720911cfd553432dda1013db6345fe3`
- OMCS plugin SHA-256: `4e6515c778f7f5f23154dcb1a1d789623bf856e8b4d890597d431162dd84e897`
- Codex CLI: `codex-cli 0.149.0`
- Node: `v25.2.1`
- grader image: `node@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c`

Re-run only with explicit model-usage approval:

```bash
node dist/cli/omcs.js benchmark run bench/prompt-refinement-pilot.json \
  --execute --approve-model-usage --json
```
