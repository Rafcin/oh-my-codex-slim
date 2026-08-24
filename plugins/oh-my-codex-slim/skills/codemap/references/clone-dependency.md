# Clone dependency source

Use dependency clones only when the user's task needs implementation details that repository code and primary documentation cannot answer. Prefer zero clones; choose a small number of load-bearing dependencies.

Before any network operation, identify the official HTTPS repository, a pinned tag or commit, and why its source is needed. Reject embedded credentials, local paths, and ambiguous revisions. If cloning was not already requested, obtain authorization before the network and filesystem mutation.

The legacy `omcs_clone_dependency` helper is not exposed by the public MCP server because its clone-size and cleanup quotas are not yet a complete security boundary. Prefer primary documentation or a user-provided checkout. If a new clone is genuinely required, stop and obtain explicit authorization for a bounded, temporary, credential-free checkout; treat it as read-only and do not run its install, build, hook, or test commands.

Reuse a matching recorded clone. If an existing destination has a different remote or revision, stop rather than replacing it. Report the repository, revision, local path, evidence inspected, and whether the clone remains necessary. Cleanup requires an explicit request and must preserve unrelated OMCS state.
