# Vendored anti-slop Oxlint plugin

Source repository: not established. The snapshot was copied verbatim from the
`install-anti-slop` agent skill bundle at
`~/.agents/skills/install-anti-slop/assets/anti-slop`; the upstream commit for
that snapshot is not recorded in the bundle.

Installed paths:

- `index.ts` — generic plugin entry (`meta.name: "anti-slop"`), registered in
  `.oxlintrc.json` as the `anti-slop` jsPlugin.
- `rules/*.ts` — generic rules; all enabled at `error`.
- `effect/` — opt-in Effect plugin, vendored but not registered because the
  project does not depend on `effect`.
- `vendor/eslint-stylistic/` — port of ESLint Stylistic
  `padding-line-between-statements`; its own `UPSTREAM.md` records the exact
  upstream commit (`435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`) and the local
  adaptations made when porting it.

Intentional deviations: none; the copy is verbatim. Local customization lives in
`.oxlintrc.json` rule configuration, never in these sources.

Updating: use the install-anti-slop skill's update procedure, then keep this
record in sync with the files actually installed.
