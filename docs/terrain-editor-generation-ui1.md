# Spherical terrain generation / generation-ui1

Integration on af4f0097. Existing editor-ui6 / workspace-ui1, ocean and fixed-base controls remain. Not an A/B replacement.

The editor dynamically loads terrain-edit-spherical-base.js. Controls: string seed, 1–7 continents, 18–45% land, grid 360x180. Exact latitude-band area weights; great-circle distance, tangent-direction ellipticity and angular coast harmonics. Four-neighbour connectivity includes longitude seam and opposite-longitude polar neighbours. Up to 32 layout attempts; failure is explicit. Separate islands, tectonic history, climate, erosion and visual redesign are not implemented. Generation runs synchronously after one yield to show status; no worker or interactive cancellation. Cross-engine bitwise transcendental-math equality is not guaranteed.

Generated fields are prepared by the real session before publishing. Unsaved replacement is confirmed; failed preparation or declined confirmation preserves the scene. Commit resets history and water; new world is dirty. Unchanged fm-terrain-workspace-v1 saves exact base and edits, NOT seed provenance. Status is a last-generation report, not metadata of subsequently opened maps.

Existing terrain-editor-page workflow is untouched. New terrain-generation workflow runs numerical generation/session/water checks and real Chromium creation, repeatability, invalid-input, brush, declined-replacement, water and fmworld restore scenarios. Native save is mocked; Mac dialogs and disk writes remain separate acceptance.

After BOTH workflows pass: build the branch ZIP using /bin/bash ./build-mac.command. Generate the same seed twice, try another seed, edit, calculate water, save a full map, switch worlds and reopen. Check declined replacement preserves edits. One combined Mac acceptance; no claim of accepted artistic coastline quality or physical continental history.
