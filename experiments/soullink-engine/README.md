# Soullink pure-engine spike

Isolated evaluation of the pinned Soullink public engine. No product wiring, no new dependencies, no model/Core writes.

The experimental bridge currently accepts only confirmed **normal** mappings. Reversed mappings are explicitly excluded with `unsupported-direction`; it must not be used as a complete calibration adapter. A profile containing only unsupported mappings fails with `BridgeError` diagnostics.

- `scripts/verify-inputs.mjs` — verify the controlled source snapshot against its manifest.
- `scripts/build-engine.mjs` — copy the snapshot into the ignored build directory, typecheck it with the app TypeScript, and bundle the public/internal entries plus the merged Uta Core-inspection adapter with the app esbuild. TEMP/TMP is redirected into `.uta-task/tmp`.
- `scripts/analyze-surface.mjs` — package exports, license/NOTICE facts, export-surface comparison and module closure.
- `src/driver.mjs` — Uta-owned profile bridge, output whitelist filter, generation/cancel wrapper.
- `src/scenarios.mjs` — fixed-seed/dt synthetic and real-profile scenarios.
- `src/benchmark.mjs` — warm-up + 5×2000 frame update benchmark and a minimal linear baseline.
- `scripts/run-experiments.mjs` — runs everything and writes raw results to `.uta-task/soullink-runs/latest.json`.
- `test/*.test.mjs` — surface, driver, scenario and real-DS tests.
- `ADR-001-engine-selection.md` — decision record.

```bash
node scripts/verify-inputs.mjs
node scripts/build-engine.mjs
node scripts/analyze-surface.mjs
node --test test/*.test.mjs
node scripts/run-experiments.mjs
```

The real-DS portion requires the task-local ignored `.uta-task/model-input` and `.uta-task/reference-inputs` inputs. Built bundles are **not** an official npm release and are never committed. The experiment never imports `internal-engine.mjs`; that bundle exists only for surface comparison.
