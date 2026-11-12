# CI evidence for commit 1582016 (plan step 1)

Commit: `1582016a864d1fbd0434be9bfeeae887b9e0dd1d`, branch `feature/natural-world-v3`, event `push`, runs created 2026-11-11 03:24 UTC. Read from the GitHub Actions API on 2026-11-12.

| Workflow | Result | Run | Artifact |
| --- | --- | --- | --- |
| world atlas checks | success | https://github.com/shavkynov/fantasy-map-studio/actions/runs/42952567299 | world-atlas-1582016a864d1fbd0434be9bfeeae887b9e0dd1d (2.97 MB) |
| Natural World v3 checks | success | https://github.com/shavkynov/fantasy-map-studio/actions/runs/42952567234 | natural-world-v3-report (291 B) |
| v4 atlas rendering checks | success | https://github.com/shavkynov/fantasy-map-studio/actions/runs/42952567494 | v4-atlas-browser-results (13.6 MB) |
| terrain editor page checks | success | https://github.com/shavkynov/fantasy-map-studio/actions/runs/42952567416 | none listed |
| spherical generation checks | success | https://github.com/shavkynov/fantasy-map-studio/actions/runs/42952567282 | none listed |

Not established by this record: other workflows in `.github/workflows` did not run for this SHA (path filters); pull-request runs (no PR event is recorded); artifact contents were not inspected; Mac/Electron, save/open and visual acceptance remain separate. A passing run is not geographic or visual acceptance.

An independent local run of the `world-atlas.yml` commands on the same commit (Node 20-compatible sandbox, Playwright 1.59-alpha instead of 1.56.1) also exited 0; it is not a CI result.
