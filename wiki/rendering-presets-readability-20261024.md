# Rendering presets and readability — 2026-10-24

2026-10-27 update: RPG lighting is restored in detailed settings, without a third Home preset. Modern HD RPG/Battle are now derived from Standard, and DE Battle has a separate no-cloud material. Readability keys and packaging were updated accordingly. The retirement and shared-melee descriptions below are historical; see [current material rules](rpg-lighting-materials-20261027.md).

Implemented locally for 3.7, not released or committed. No real client/game launched, no real game deployment, no Latest modifications and no version/gate/manifest changes. Existing other-task edits were preserved.

## Final user rules

| Preference | Standard | Competitive |
| --- | --- | --- |
| Lighting / brightness | standard / 3 | battle / 4 |
| Trees | Quenching tall/DE tree (tall) | v16 |
| Terrain | latest | v16 |
| Object shader / shadow post-processing / glow post-processing | on | on |
| Foliage / Blight / volumetric fog | on | on |
| Weak hero glow | on | off (strong/native option) |
| Enhanced Fog outline | off | on, including DE |
| Improve readability preference | off | on |

Home renders exactly two preset buttons. Highlighting is derived from actual preference values; a manually changed combination does not retain a misleading preset flag. Graphics and game version remain separate. Presets do not turn on VisionMod-dependent half portraits/model enhancements, alter custom camera/UI preferences, or choose a different water style. Existing water settings still obey the HD/DE profile's water rules.

The detailed RPG lighting control remains available. RPG selects Standard HD shaders and paired terrain/cliff writers, retaining only DNC lighting differences. Standard/melee sources stay independent within each Retail/PTR/legacy pack.

## Readability and reversible unit scaling

3.7 first-release scope confirmed by the user: 2.04 keeps its existing lighting,
brightness, terrain and tree support, but receives none of this iteration's new
readability/emissive/outline enhancements or unit shrinking. Saved battle preset
flags do not authorize modern HD/Fog resources on that version. Its readability
and enhanced-outline controls remain unavailable. The separate 2.04 HD-only
pseudo-outline/emissive research is experimental, not part of 3.7; it must not
modify or depend on Fog and must not be copied into official assets or Latest.

A new graphics settings section and persisted improveReadability boolean (default false) are wired through the hook, preload, API types and shader:update-readability IPC. Following the user's DE extension, shader effects take effect in HD/DE 3.0.1+; SD/3.0/2.04 ignore them. Object shaders and shadow post-processing must be enabled; disabling either restores normal unit sizes and removes/deactivates the paired effect. The stored preference can be retained while unsupported. Unit shrinking remains HD-only; DE scale values and custom paths remain unchanged.

Readability comprises team emissive + team-color outline and reversible unitskin scaling. It is separate from postProcessingOutline, which selects the existing base/enhanced black Fog outline. Lighting no longer independently authorizes unit scaling. All skin/profile/custom-skin write paths now consult the readability setting and resolved v301 version; active, disabled and parked skin copies preserve their unscaled values. Repeated application does not accumulate shrinkage. Turning it off restores original custom scales and leaves custom model paths intact.

PTR still passes its independent precise-build compatibility gate. The extension also checks the selected independent pack's base HD hash against the extension's build provenance; it cannot silently replace a mismatched PTR base with Retail bytes.

## Resource work and provenance

The original exported team resources are documented in D:/Quenching/QM/shaders/99_Docs/Team_Color_301_Integration_20261023.md. Their effect requires **three paired PS files**, not only hd.bls.

Private build tool: _irys/build-client-readability.py. Outputs and detailed per-profile input/output hashes, effects, GPU and driver results: _irys/work/readability-20261024/build_report.json.

The tool reads current Standard/melee HD and the existing four Fog variants, then applies the shared team_color_301 implementation. It initially generated four compatible sets under assets/quenching/shaders/readability-301 (ao_080, ao_066, ao_080_outline, ao_066_outline), each with HD/fog/volumetricfog. The subsequent DE extension adds two more sets, described below. This preserves current Fog settings:
- AO standard/RPG 0.8, battle 0.66.
- Base black outline 0.4/width 2, enhanced black outline 0.75/width 3.
- Team emissive 0.33, team outline 0.16/width 2, independently composed after Fog.

Each of four sets passed 41 GPU regression checks and physical shader creation on AMD Radeon(TM) Graphics and NVIDIA GeForce RTX 3080 Laptop GPU (410 unique programs per GPU per set). These offline checks are not game screenshot/performance acceptance.

Only two obsolete source files were removed: shaders-300-hd/ps/rpg/hd.bls and shaders-ptr-hd/ps/rpg/hd.bls. Hash-verified copies are recoverable under _irys/work/readability-20261024/removed-rpg-hd. Other source RPG programs remain historical inputs but modern packaging excludes the whole unused /ps/rpg/ subtree. The immutable legacy 3.0 ZIP was not rebuilt. Upstream historical exporters that still expect three separate HD inputs must be updated before reuse; this task's builder uses only Standard/melee.

Updated shaders.zip after DE extension: 125 entries, 24,931,663 bytes, SHA-256 46356bb3ea223a3aa93f3b44da1ab423e24799f933d04a83ff879e54f6fcd475. Every archive entry was compared byte-for-byte to its loose source (0 mismatches); no RPG entry is distributed. Readability files are selectively expanded with modern HD/DE packs only.

### DE extension

The DE PS hd.bls and HD melee PS hd.bls are byte-identical (SHA-256 f8ccf4e61ac3d8c17e150adba920049836785bcff519379385d422671f5350cd), including the current independent PTR equivalents. DE always keeps that base, regardless of lighting. DE Battle reuses ao_066 / ao_066_outline; DE Standard/RPG select new de_ao_080 / de_ao_080_outline, combining the DE base with AO 0.8 Fog. HD Standard is not substituted for DE. Turning the feature off restores the selected DE pack's own HD file and normal Fog variant.

Private tool _irys/extend-de-readability.py and report _irys/work/de-readability-20261024/build_report.json record both additional sets. Each passed 41 GPU regression checks and two physical drivers with 410 unique programs each. No base HD, ordinary Fog, unitskin template, Latest or game file was overwritten by this extension. The independent PTR build gate and base hash check remain.

Extended tests cover DE/PTR-DE Standard/Battle/RPG, both black-outline strengths, paired enable/disable/restoration, unknown PTR rejection, actual SettingsModal availability in HD/DE 3.01 and disabled older/SD profiles, and byte-identical custom DE modelScale fields. Eight locale descriptions now distinguish HD/DE shader effects from HD-only shrinking. Real game visual/performance acceptance remains outstanding.

## Retired Intel/AMD feature

Removed its UI, translations, preload/API and IPC handler, startup/sync overrides and runtime helper. Legacy configuration is ignored and removed when settings load; no old saved true value runs bloom replacement. No historical published manifest or old client bundle was edited.

## Code and behavioral checks

- Shared preset/support rules: src/shared/rendering-presets.ts.
- Resources and preflight: mod-profile.ts, fog-shader-override.ts, shader-bundle.ts, asset-sync.ts and shader-handlers.ts.
- Scaling: shared/battle-unit-scale.ts, unit-skin-profile.ts, skin-service.ts, retro-skin-service.ts, version-skin-service.ts.
- UI: MainWindow/index.tsx, SettingsModal.tsx, useWar3Settings.ts, i18n.ts; eight locales include the new controls.
- Fixed a pre-existing Blight-only early return so multi-field presets are not silently discarded.

Passed targeted tests:
- test-rendering-presets-readability.ts (all lighting/Fog combinations, ZIP-only resources, on/off restoration, base mismatch preflight, unsupported versions and custom/parked scales)
- test-graphics-settings-transition.ts (actual hook batch presets and reloading preferences; retired UI absent)
- test-battle-unit-scale.ts, test-unit-skin-profile.ts, test-version-skin-service.ts
- test-shader-301.ts, test-startup-rendering-files.ts, test-fog-shader-override.ts
- test-ptr-shader-compatibility.ts, test-destructable-skin-versions.ts, test-startup-rendering.ts
- check-i18n.mjs: eight locales, 1308 keys each; missing/duplicate/placeholder mismatch 0
- strict scoped shared-policy TypeScript checks
- node --import tsx scripts/webpack.build production: complete

React review retained existing UI components and wrapping options, accessible button groups/pressed/disabled states, event-driven application and derived highlighting (no second preset state to drift). No unrelated UI/library refactor.

The whole dirty tree's diff --check still reports pre-existing whitespace in PostProcessingConfig.txt/unitskin-de.txt and mixed-line-ending retrofit work; no global cleanup of others' resource edits was attempted. Product build success is not a claim that the repository's historical full tsc diagnostics are fixed.

## Remaining acceptance

Actual UI operation, full process restart and real-game graphics/performance acceptance remain for the user. No release, installation package, online source changes, or automatic update push was performed. Existing config/UI rollback and staged shader replacement remain; this does not claim a new all-files transaction across every preset resource IPC.
