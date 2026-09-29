# 1.0.0 (2026-09-29)


### Bug Fixes

* detect a cycle back to a config reached through a symlink ([10f4f9c](https://github.com/ExaDev/cosmiconfig-extends/commit/10f4f9c10e472cd007bdf2449820533a29e5980d))
* never let the environment switch jiti to native imports ([9a1f6c7](https://github.com/ExaDev/cosmiconfig-extends/commit/9a1f6c7e7dabacfd94864455d709ebd0e8e17a5d))
* re-evaluate JavaScript and JSON presets that jiti would serve from the runtime cache ([edd83a7](https://github.com/ExaDev/cosmiconfig-extends/commit/edd83a7ff65f2a442e169efb929e651598eaf5a1))
* refuse a reference unless the trust predicate returns exactly true ([03eeac5](https://github.com/ExaDev/cosmiconfig-extends/commit/03eeac585ad575a0bff66dc27bc81dd09277a6b4))
* reject dot segments in package specifiers and classify file URLs as local ([ad9722e](https://github.com/ExaDev/cosmiconfig-extends/commit/ad9722ef2931065c4d192cec51c63a00c9255bde))
* replace dates, regular expressions, maps and class instances instead of rebuilding them ([97c08ff](https://github.com/ExaDev/cosmiconfig-extends/commit/97c08ff6b0b433b426c7af444e8641e5f5a3cb81))
* return undefined for a config that exports undefined ([b5d9070](https://github.com/ExaDev/cosmiconfig-extends/commit/b5d9070615f583a561867377d69fd97e086f6d01))
* trust-check a local reference that resolves into another package ([3e877db](https://github.com/ExaDev/cosmiconfig-extends/commit/3e877db3ae4aaed7abca004d1a49c85f7fb5d555))


### Features

* add a default deep merge that treats __proto__ as data ([8c050a6](https://github.com/ExaDev/cosmiconfig-extends/commit/8c050a6326631399f37cf663948e133b21f45a27))
* add a jiti loader with directory aliases and explicit caches ([8c2a207](https://github.com/ExaDev/cosmiconfig-extends/commit/8c2a207ff2b7569fd1c26fc5f587dc7de5576dfa))
* add a trust-gated extends transform with path-based cycle detection ([cbceb69](https://github.com/ExaDev/cosmiconfig-extends/commit/cbceb69b222c376c648966317e1b0e178286f973))
* add createDefineConfig, an authoring helper that applies no defaults ([d975b1e](https://github.com/ExaDev/cosmiconfig-extends/commit/d975b1e2c891e884ffd3b33fcb27d1f766333354))
* add createExplorer over cosmiconfig with jiti loading and extends ([827e2c6](https://github.com/ExaDev/cosmiconfig-extends/commit/827e2c6e35cfc6de1c926b4e4d489e5938f953ca))
* extract a module's default export from a jiti namespace ([4cbd050](https://github.com/ExaDev/cosmiconfig-extends/commit/4cbd0504cc44a3d5713dfb2191425c0392ca3269))
* validate with any Standard Schema and report normalised issues ([7cda99a](https://github.com/ExaDev/cosmiconfig-extends/commit/7cda99ad2eae0afabd47a412e57e187e4ae4bd8c))
