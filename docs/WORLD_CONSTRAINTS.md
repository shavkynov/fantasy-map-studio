# World constraints — user decisions

Recorded 2026-11-03. Documentation only; not implemented or validated generator behavior.

## Continents

The generated map must have at most seven continents, not necessarily exactly seven.
This is a continent limit, not a tectonic-plate limit and not a replacement for the six-piece analytic K6 experiment.
The operational continent/island classification and any size threshold remain unspecified; do not invent a threshold or silently change connected-component counting.

## Planet age

The intended planet age is approximately Earth's age: 4.54 billion years as the working reference already discussed with the user.
The user explicitly rejected interpreting Earth's age as only an upper bound: it is also the lower reference, with a small allowed drift around it.
Supported worlds are therefore near Earth-age, not an unrestricted range from young planets to Earth-age.
The numeric drift, exact lower/upper bounds, default sampling distribution and UI controls are not agreed. Do not invent a percentage or hard-code a range before agreement.
This is planet age since formation, not a prescribed age for each continent, rock unit or civilization. The age constraint alone is not geological validation.

## Planet dimensions

The user's earlier position on planet dimensions is unchanged. Its numerical specification has not been recovered in the current handoff/memory review.
Do not infer Earth-sized dimensions from the age requirement. Do not reinterpret raster resolution or the analytic unit sphere as the chosen physical planet size. Preserve existing settings; recover the original decision before changing size behavior.

## Scope and implementation boundaries

These decisions do not alter geometry, K6 piece count, poses, collision logic, area policy, fixtures, baselines, expected values or visual references.
No runtime enforcement, UI integration, geology acceptance or new measurement is claimed by this document.
Keep geometry, geology/climate and UI work separate. Future implementation needs its own small reviewed package and tests.
