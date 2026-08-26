# Third-party notices

This project is an attributed fork baseline. The source repositories and
revisions below are pinned in [`.upstream-revisions.json`](.upstream-revisions.json).
Adapted files must retain the applicable notice.

## Yeachan-Heo/oh-my-codex

- Repository: <https://github.com/Yeachan-Heo/oh-my-codex>
- Revision: `3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2`
- License: MIT, as declared by `package.json` at the pinned revision.
- Author metadata (not a copied literal notice): the pinned `package.json`
  records `"author": "Yeachan Heo"`.
- Repository-owner metadata (not a copied literal notice): the authoritative
  upstream owner identity is `Yeachan-Heo`, as shown by the repository URL.
  The pinned tree has no standalone `LICENSE`, `COPYING`, or copyright-notice
  file, so there is no separate copyright line to reproduce.

## alvinunreal/oh-my-opencode-slim

- Repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT.
- Upstream-owner/author metadata (not a copied literal notice): the pinned
  `.all-contributorsrc` records project owner/login `alvinunreal` and display
  name `Alvin`; no fuller legal name is published there or in the pinned
  package metadata.
- Copyright notice, reproduced from the pinned `LICENSE`:

  ```text
  MIT License

  Copyright (c) 2025

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

## mattpocock/skills

- Repository: <https://github.com/mattpocock/skills>
- Revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT.
- Upstream author/copyright-holder metadata: the literal pinned notice names
  `Matt Pocock`; the authoritative repository owner identity is `mattpocock`.
- Copyright notice, reproduced from the pinned `LICENSE`:

  ```text
  MIT License

  Copyright (c) 2026 Matt Pocock

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

## DannyMac180/sol-advisor

- Repository: <https://github.com/DannyMac180/sol-advisor>
- Revision: `37b75cad535abdd46531f0227483a8842d045ab8`
- License: MIT.
- Upstream author/copyright-holder metadata: the literal pinned notice names
  `Daniel McAteer`, and the pinned plugin metadata repeats author name
  `Daniel McAteer` with URL/owner identity `DannyMac180`.
- Copyright notice, reproduced from the pinned `LICENSE`:

  ```text
  MIT License

  Copyright (c) 2026 Daniel McAteer

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

## duolahypercho/codex-router legacy compatibility

- Repository: <https://github.com/duolahypercho/codex-router>
- Revision: `866cb8b011fa8e16900c77c58249b71eec6436ca`
- License: MIT.
- Current use: retained only for attributed legacy adapter and migration rollback
  compatibility. Codex Router is not the supported active transport; OpenCodex
  is.
- Upstream author/contributor/owner metadata: pinned revision
  `866cb8b011fa8e16900c77c58249b71eec6436ca` records Git commit author name
  `Duola`; the literal pinned notice identifies `codex-router contributors`;
  and the authoritative repository owner identity is `duolahypercho`. No
  fuller legal name is published at this revision, so none is invented here.
- Copyright notice, reproduced from the pinned `LICENSE`:

  ```text
  MIT License

  Copyright (c) 2026 codex-router contributors

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

## lidge-jun/opencodex supported transport, interface reference, and adapted TOML ownership logic

- Installed package inspected: `@bitkyc08/opencodex` version `2.25.0`.
- Repository: <https://github.com/lidge-jun/opencodex>
- License: MIT.
- Current use: supported external-model transport. OpenCodex remains separately
  installed and owns its service, provider authentication, model catalog, and
  credentials; OMCS does not vendor or copy those secrets.
- Status: interface reference plus a narrow code adaptation. The structural
  TOML line scanner and ownership-aware removal of OpenCodex-managed native
  subagent defaults in `src/router/migrate-opencodex.ts` are adapted from the
  installed package path `src/codex/subagent-defaults.ts` at package version
  `2.25.0`. The remainder of the OMCS migration implementation is original.
- Interface behavior inspected: ownership metadata, the version-1
  `${CODEX_HOME}/opencodex-journal.json` contract, the version-2.25.0
  drift-preserving owned-field restore behavior, `ocx restore`, `ocx stop`,
  ownership-aware `ocx uninstall`, and the service `status`, `stop`, and `start`
  boundaries used to preserve rollback state.
- Upstream contributor/owner metadata: the literal installed notice identifies
  `opencodex contributors`; the authoritative repository owner identity is
  `lidge-jun`. No fuller personal legal name is published by the installed
  package, so none is invented here.
- Copyright notice, reproduced from the installed `LICENSE`:

  ```text
  MIT License

  Copyright (c) 2026 opencodex contributors

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

## Oh My OpenAgent boundary

- Source repository: <https://github.com/code-yeongyu/oh-my-openagent>
- Source path(s): no source text or prompt copied; repository-level behavioral reference only
- Pinned revision: `b48ab1086b338921ccd99a11183f91eefbb169f2`
- License: Sustainable Use License
- Status: behavioral reference only; no adaptation or inclusion
- Upstream author/copyright holder: no personal name published in the inspected repository metadata
- Repository owner: `code-yeongyu`

## Skill-level provenance

Every skill below is a modified, Codex-native adaptation. The author and owner
fields identify authoritative upstream metadata; they do not claim wording that
is absent from a pinned copyright notice.

### ai-slop-cleaner

- Source repository: <https://github.com/Yeachan-Heo/oh-my-codex>
- Source path: `skills/ai-slop-cleaner/SKILL.md`
- Pinned revision: `3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)
- Repository owner: `Yeachan-Heo`

### codebase-design

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/codebase-design/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### context

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/grill-with-docs/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### codemap

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/codemap/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### code-review

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/code-review/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### deep-interview

- Source repository: <https://github.com/Yeachan-Heo/oh-my-codex>
- Source path: `skills/deep-interview/SKILL.md`
- Pinned revision: `3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)
- Repository owner: `Yeachan-Heo`

### deepwork

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/deepwork/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### diagnose

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/diagnosing-bugs/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### implement

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/implement/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### omcs

- Source repository: <https://github.com/DannyMac180/sol-advisor>
- Source path: `plugins/sol-advisor/skills/orchestration/SKILL.md`
- Pinned revision: `37b75cad535abdd46531f0227483a8842d045ab8`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Daniel McAteer
- Repository owner: `DannyMac180`

### omcs-orchestrate

- Source repository: <https://github.com/DannyMac180/sol-advisor>
- Source path: `plugins/sol-advisor/skills/orchestration/SKILL.md`
- Pinned revision: `37b75cad535abdd46531f0227483a8842d045ab8`
- License: MIT
- Status: compatibility alias
- Upstream author/copyright holder: Daniel McAteer
- Repository owner: `DannyMac180`

### plan

- Source repository: <https://github.com/Yeachan-Heo/oh-my-codex>
- Source path: `skills/plan/SKILL.md`
- Pinned revision: `3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)
- Repository owner: `Yeachan-Heo`

### research

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/research/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### simplify

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/simplify/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### tdd

- Source repository: <https://github.com/mattpocock/skills>
- Source path: `skills/engineering/tdd/SKILL.md`
- Pinned revision: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Matt Pocock
- Repository owner: `mattpocock`

### verification

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/verification-planning/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### codemap supporting resource: clone-dependency

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/clonedeps/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### deepwork supporting resource: worktrees

- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>
- Source path: `src/skills/worktrees/SKILL.md`
- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`
- License: MIT
- Status: modified adaptation
- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)
- Repository owner: `alvinunreal`

### ast-grep CLI runtime dependency

- Package: `@ast-grep/cli` version `0.45.1`
- Source repository: <https://github.com/ast-grep/ast-grep>
- Release tag revision: `dc3d655b9edf3b2bc266d9bc46eb60f18e66b818`
- Status: unmodified pinned runtime dependency; OMCS code-intelligence wrappers are original project code
- Upstream author and copyright holder: Herrington Darkholme (`HerringtonDarkholme`)
- Repository owner: `ast-grep`
- License: MIT

Copyright (c) 2022 Herrington Darkholme
