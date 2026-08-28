# Benchmarking OMCS against plain Codex

OMCS includes a paired benchmark harness for answering one practical question: does activating OMCS improve verified engineering outcomes enough to justify its time and token overhead?

The harness does not run a model unless both `--execute` and `--approve-model-usage` are present. A user must still explicitly approve that billed matrix before anyone invokes it.

## Current tuning state

The August 27 pilot is frozen development evidence for the original
ceremony-heavy `auto` policy. It is not a held-out proof set for the checked-in
thin-kernel redesign. That redesign defaults `auto` and `fast` to `solo`, uses
at most one auxiliary, separates consequence from uncertainty, treats an
auxiliary as a substitute for primary-context work, activates cleanup only for
a concrete named finding, and makes green acceptance evidence a binding stop
condition.

The redesigned policy is not yet benchmarked. Do not relabel the existing chart
or results as post-redesign performance. A new comparative result requires a
separately approved paired run with frozen tasks, randomized order, matched
sandboxes, repeated trials, hidden grading, transcript activation audit, and no
grader or fixture tuning after outcomes are visible.

## What is compared

Every task and repetition has two arms:

- `codex-default` runs Codex with the suite's fixed model, reasoning effort, sandbox, and approval policy in an independent temporary home with zero plugins, MCP servers, or custom agents; it also ignores user configuration and rules and disables plugins and hooks.
- `omcs` holds those controls constant in a separate temporary home containing only the OMCS plugin, the exact eight-agent catalog, and its bounded `omcs_code_intel` MCP, then activates the selected OMCS profile.

Prompts travel over stdin, not command-line arguments. Before execution, the harness copies every declared fixture and grader asset exactly once into a private immutable snapshot. The public plan and private result record SHA-256 provenance for the suite, each prompt, fixture, grader, OMCS plugin surface, complete checked-out OMCS runtime, benchmark harness, Node executable, Codex CLI version, OMCS version, and pinned grader image. Each arm then receives a fresh copy and fresh Git repository from that snapshot.

The Codex executable is resolved to an absolute path before either arm starts. Model commands receive a private tool directory containing only the exact hashed Node executable plus the minimum operating-system path. A preflight resolves that effective path and fails closed unless it finds exactly the private Node executable and no `omcs` command anywhere. In the treatment's owned temporary plugin cache, the MCP registration is rewritten and read back as an explicit invocation of this checkout's `dist/cli/omcs.js`, never a bare `omcs` command. It deliberately has no fixed working directory, so Codex launches it in each fresh benchmark workspace; a functional no-model probe proves the pinned server can inspect that workspace.

Graders run as a capability-free process in the digest-pinned Node container `node@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c`. The container has no network, no capabilities, no writable root filesystem, no host home or credentials, and read-only mounts for only the frozen grader assets and completed workspace. It returns only `verified` and `safetyViolations`. Docker 29 or a compatible Docker Engine is required for execution, but not for planning or reporting.

Raw JSONL, stderr, the frozen plan, provenance, and an fsync-backed progress journal remain private under `.omcs/benchmarks/` with owner-only permissions. Results embed the complete plan and its digest; reporting recomputes that digest, requires exact plan/result run equality, and requires the matrix task set to equal the frozen task-provenance set. The hashed runtime closure recursively includes every installed production dependency, present optional dependency, and present peer dependency, and the runner re-hashes the live runtime and immutable snapshot before publishing a completed result. Every spawned process gets its own process group; timeout and normal-exit cleanup both terminate lingering same-group descendants before grading or workspace cleanup. Timeouts become explicit failed outcomes and do not censor the remaining paired matrix; authentication, invocation, and grader infrastructure failures still stop the run. A stopped matrix can resume only when the live suite, installed OMCS surface, Codex version, and preserved snapshot reproduce the original provenance exactly:

```bash
node dist/cli/omcs.js benchmark run bench/prompt-refinement-pilot.json --execute --approve-model-usage --resume .omcs/benchmarks/<run> --json
```

This is a product-level activation comparison. It measures the full OMCS prompt, skill, agent, and review behavior against a clean Codex execution. It is not a model benchmark.

## Checked-in calibration pilot

[`bench/prompt-refinement-pilot.json`](../bench/prompt-refinement-pilot.json) contains six tasks across bug fixing, feature work, diagnosis, security, and documentation. Three paired repetitions produce 36 runs.

The public pilot is a canary for harness and prompt refinement. Its fixtures, graders, and oracle solutions are public, so results must not be presented as held-out leaderboard evidence. The repository test gate proves every starting fixture fails its grader and every oracle passes before the suite can be used.

The README intentionally separates two displays:

- **grader calibration:** 0 of 6 untouched fixtures pass; 6 of 6 checked-in reference oracles pass;
- **comparative performance:** the valid August 27, 2026 matrix reports 16/18 Plain Codex passes and 15/18 OMCS passes, plus time, token, timeout, safety, uncertainty, and task-level outcomes separately.

The checked-in reference oracle is acceptance-test evidence, not output from the paired benchmark. The published generated-code example comes from a valid treatment transcript and is explicitly described as acceptable output rather than proof of superiority. See the [full mathematical result](benchmark-results/2026-08-27-prompt-refinement-pilot.md) and [sanitized pair-level observations](benchmark-results/prompt-refinement-pilot-2026-08-27.csv).

Plan or dry-run it without model usage:

```bash
npm run build
node dist/cli/omcs.js benchmark plan bench/prompt-refinement-pilot.json --json
node dist/cli/omcs.js benchmark run bench/prompt-refinement-pilot.json --dry-run --json
```

After the user explicitly approves a 36-run model matrix, the execution command is:

```bash
node dist/cli/omcs.js benchmark run bench/prompt-refinement-pilot.json --execute --approve-model-usage --json
```

The command creates both minimal Codex homes and reads back the baseline's empty integration state and the treatment's exact plugin, MCP, and eight-agent catalog state before the first model request. It temporarily links the existing private Codex authentication file into each owner-only directory so the Codex parent can authenticate. A custom filesystem permission profile exposes minimal platform paths and the benchmark workspace to model-generated commands; both arms also receive the explicit `codex exec --sandbox workspace-write` control, while the treatment additionally receives read-only access to the exact installed OMCS plugin root so its skill instructions are usable. The remainder of each Codex home stays unreadable. Before execution, a no-model synthetic access probe must prove the workspace and treatment skill file are readable while each linked authentication path is not. The harness removes both temporary homes at the end, never prints or copies credential values, inherits only a small environment allowlist, and never starts a login flow.

Transcript audit is a publication gate. All 18 treatment transcripts in the valid matrix contained OMCS activation evidence, all 18 control transcripts lacked it, and neither arm reported the earlier read-only or skill-access failure. This remains a CLI activation benchmark: the isolated model PATH intentionally contains no `omcs` executable, and some transcripts reported specialist lanes unavailable. It does not measure the full Codex Desktop multi-agent ceiling.

Summarize a saved private result:

```bash
node dist/cli/omcs.js benchmark report .omcs/benchmarks/<run>/results.json --json
```

## Reading the result

The report deliberately avoids a composite score. Compare:

- verified success rate and the paired improvement/regression counts;
- median wall time and tokens when Codex exposes complete usage events, alongside explicit usage-coverage and transcript-truncation counts;
- safety violations, which must remain zero;
- run-to-run variance and the private failure taxonomy.

For prompt refinement, inspect only failed or regressed pairs, classify the failure before editing, and change one prompt or skill contract at a time. Keep the task suite, seed, model, reasoning effort, and repetition count frozen. Re-run the same matrix, then validate promising changes on a separate private held-out suite to avoid tuning directly to the public canary.

Useful initial thresholds are an 8–10 percentage-point verified-success improvement, or non-inferior success with at least 25% fewer escaped defects, no safety violations, and a median time/token premium below roughly 50%. These are project decision thresholds, not claims about statistical significance.

The valid public pilot missed those thresholds: OMCS's paired success delta was −5.6 percentage points, median wall time was 1.99× Plain Codex, and the complete-pair median-token ratio was 3.25×. The exact discordant-pair test was `p = 1.000`; with only 18 pairs, uncertainty remains wide. The immediate refinement target is a smaller `auto` route for settled narrow work plus a hard orchestration budget.

Two earlier matrices are excluded from all published estimates. The first treatment could not read its skill root. The second omitted the explicit `--sandbox workspace-write` Codex control and caused the baseline to report a read-only workspace. Keeping the invalid runs documented prevents favorable but confounded numbers from being recycled.

## Authoring private held-out suites

Copy the public manifest shape into a private directory ignored by Git. Keep fixtures and every declared `graderAssets` file beneath that suite root; the runner rejects escaping paths, symbolic links, hard links, undeclared grader entry points, and non-Node graders. Graders and optional setup commands are argv arrays, never shell strings, and execute only in the pinned networkless container.

A serious release evaluation should use 30–50 private tasks, randomized paired order, three to five repetitions, blind review, and task-quality auditing. Exclude broken or ambiguous tasks with a recorded reason instead of changing graders after seeing which arm failed.

## Methodology credits

The oracle-validation and isolated-task approach is informed by the authors and contributors named in the official citation metadata for *Terminal-Bench: A Benchmark for AI Agents in Terminal Environments*. The held-out, end-to-end grading approach is also informed by *SWE-Lancer* by **Samuel Miserendino, Michele Wang, Tejal Patwardhan, and Johannes Heidecke**. OMCS does not copy code or benchmark data from either project.

<details>
<summary>Terminal-Bench authors and contributors named in the official citation metadata</summary>

Ryan Marten; Alex Shaw; Ivan Bercovich; Benedikt Droste; Tommaso Cerruti; Steven Dillmann; Ruiyang Wang; Dariush Wahdany; Allen Hart; Karl Krauth; ScaleAI; Snorkel AI; Turing; gNucleus AI; Boolean AI; Nicholas Carlini; Shengrui Lyu; Anjiang Wei; Arpandeep Khatua; Björn Plüster; Chaitanya Dwivedi; Christine Sutcliffe; Yuming; David Tivris; Di Wang; Hui Wen Goh; Hanwen Xing; Haowei Lin; Irakli Salia; Jaejung Seol; Jiajun Bao; Jialin Ouyang; Junha Park; Liam Walsh; Luyang Kong; Maksim Ivanov; Malte Ubl; Mikhail Liamets; Orfeas Menis; Piotr Migdal; Qingquan Bao; Raj Movva; Roey Ben Chaim; Namburi Srinath; Sergey Bogdanik; Shubham Yadav; Stephen Benjamin; Tony Kung; Walker Hughes; Xin Lan; Himanshu Gupta; Swaroop Mishra; Chenguang Wang; Hao He; Jianhong Tu; Kyle Montgomery; Zengji Tu; Atharva Naik; David Mortensen; Ivan Zhang; Yash Mathur; Emmy Liu; Karanpartap Singh; Michael Yu; Steven Feng; Varun Gangal; Zhuofu Tao; Sherry Ruan; Jonas Mueller; Joan Cabezas; Justin Bauer; Kevin Xiang Li; Robert Zhang; Aaron Feller; Alec Madayan; Leon Chen; Ben Feuer; Xiangyi Li; Boxuan Li; Harsh Raj; Samuel Galler; Lin Shi; Ivgeni Segal; Kelly Buchanan; Shreyas P.; Rishi Desai; Aaron Schneider; Chris Settles; Xiangning Lin; Marianna Nezhurina; Andrew Wang; Michał Kowalczyk; Jin-Xiang Zhao; Sanyam Satia; Jessie Hu; Sherif Atef; Kobe Chen; Sam Vance; Gian Segato; Jenia Jitsev; Alex Dimakis; Mike Merrill; Andy Konwinski; Ludwig Schmidt.

</details>

- [Terminal-Bench official citation metadata](https://github.com/harbor-framework/terminal-bench/blob/main/CITATION.cff)
- [SWE-Lancer publication](https://openai.com/index/swe-lancer/)
