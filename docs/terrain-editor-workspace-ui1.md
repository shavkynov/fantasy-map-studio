# TEST editor-ui6 / workspace-ui1

Single standalone-map milestone on the accepted editor-ui5 base. The shaping module installs the workspace adapter before the page captures its session. The header is upgraded at runtime; the static HTML retains the accepted shaping controls. Main application remains .17.

New maps use either an all-ocean 360x180 base or a detached copy of the original fixed procedural A base. Procedural does not mean a new random seed. Brushes and water equations unchanged.

Full document: fm-terrain-workspace-v1 with name and original fm-terrain-edits-v1 patch, including its exact original base. No water, history, arbitrary-resolution import, A/B recipe adoption or full application snapshot. Old patch import remains base-checked. New initialPatch session construction validates and prepares imported changes without adding an Undo entry.

Open stages a detached fully prepared session before replacement. Invalid input, preparation failure and user rejection preserve old state. File size capped at 32 MiB. Only current grid accepted. Commit is single-use and revision-checked; successful replacement cancels old water, advances the global revision, resets history/comparison and refreshes canonical and height views. Zoom remains a display preference; all worlds have the same grid. Replacement cannot be undone into another world.

Dirty state compares canonical name plus full patch with the last opened/confirmed-saved document. Undo to the saved geometry can clear dirty. Renaming is outside terrain Undo. Initial unchanged procedural sample has no saved file; newly created maps are dirty. Browser download does not prove disk persistence and deliberately does not clear dirty. Electron saveWorld resolves a path only after writing; null cancellation and errors preserve dirty. File dialogs and actual Mac disk writes require manual acceptance. Replacement prompts for dirty content; no autosave or guaranteed application-close recovery.

Automated package: eight numerical workspace groups with real session/drainage/water, plus six native Chromium scenarios covering ocean sculpting, full save, rejected replacement, world switching/restoration, malformed/foreign files, history isolation, water, zoomed PNG, old patches and mocked Electron save cancellation/error/success. Existing full browser suite is retained. Definitions are not passing results.

After green CI, one Mac session: create ocean world, name and sculpt it, save full map, create a different procedural map, reopen the first map, edit/undo, recalculate water, export PNG. Try cancelling replacement and a save dialog; verify unsaved status remains. Do not request separate builds for individual controls.
