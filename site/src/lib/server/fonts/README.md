# Vendored fonts

These files are licensed under SIL Open Font License 1.1.

- `inter-400.ttf` — Inter Regular 400 (rsms/inter v3.19)
- `inter-600.ttf` — Inter SemiBold 600 (rsms/inter v3.19)

Source: https://github.com/rsms/inter

The OG renderer (`src/lib/server/og-render.ts`) inlines these files as
ArrayBuffers. We vendor the exact subset we render with rather than
npm-installing `@fontsource/inter` to avoid the ~3 MB multi-weight bundle.

## License

OFL-1.1 — https://scripts.sil.org/cms/scripts/page.php?site_id=nrsi&id=OFL
