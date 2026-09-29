# cosmiconfig-extends

A jiti-backed TypeScript loader and a trust-gated `extends` transform for [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) 9 and 10, with configurable merging and Standard Schema validation.

## Development

Requires Node 22 or later for the toolchain (the published package supports Node 20 or later) and pnpm.

```sh
pnpm install
pnpm lint            # eslint, with --fix
pnpm typecheck
pnpm test            # vitest, with coverage
pnpm build           # tsdown: ESM, CJS and declarations
pnpm test:mutation   # Stryker, 100% break threshold
```

CI also runs `pnpm exec publint` and `pnpm exec attw --pack` after the build.
