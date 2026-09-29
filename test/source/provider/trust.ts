// provider/trust — the provider trust and supply-chain policy.
//
// Loading a provider EXECUTES its code: a provider package exports a
// defineProvider call and a generate() function the engine invokes, and reading
// either runs the module's top-level code. The host security posture therefore
// applies to provider packages exactly as it does to any dependency: a minimum
// release-age policy and disabled install scripts when the provider package is
// fetched, and an explicit trust decision before the module is loaded.
//
// The trust gate is the boundary the discovery/loading path consults before a
// provider is loaded. First-party (@my-tool/*), `self`, and local-path providers
// are trusted by default; everything else is untrusted unless explicitly
// allowlisted. The decision states plainly that adding a provider runs code, so
// the CLI can surface it rather than hiding it.
//
// This module is pure: a deterministic classification of a provider reference
// string. It performs no I/O — fetching a package and applying the install
// policy is the CLI's job, expressed through the policy this module returns.

/**
 * The scope prefix that marks a first-party @my-tool provider package. A package
 * specifier under this scope is trusted by default.
 */
const FIRST_PARTY_SCOPE = '@my-tool/'

/**
 * The literal binding meaning the developer implements the port themselves. No
 * external code is loaded, so it is trusted by definition.
 */
const SELF_REF = 'self'

/**
 * Where a provider reference comes from, which determines its default trust.
 *
 * - `self`        — the developer implements the port; no external code loaded.
 * - `first-party` — an @my-tool/* package the tool's authors maintain.
 * - `local`       — a relative-path provider inside the developer's own repo.
 * - `third-party` — any other package specifier; untrusted by default.
 */
export type ProviderOrigin = 'self' | 'first-party' | 'local' | 'third-party'

/**
 * Classify where a provider reference comes from. Pure string inspection.
 *
 * A reference is one of: the `self` literal, an @my-tool/* package, a relative
 * path ('./' or '../'), or any other package specifier (third-party).
 */
export function providerOrigin(ref: string): ProviderOrigin {
  if (ref === SELF_REF) {
    return 'self'
  }
  if (ref.startsWith(FIRST_PARTY_SCOPE)) {
    return 'first-party'
  }
  if (ref.startsWith('./') || ref.startsWith('../')) {
    return 'local'
  }
  return 'third-party'
}

/**
 * The trust policy: which third-party provider references the operator has
 * explicitly opted into. First-party, self, and local providers never need to
 * appear here — they are trusted by origin. An empty (or absent) allowlist means
 * no third-party provider is trusted.
 */
export interface ProviderTrustPolicy {
  readonly allowlist?: readonly string[]
}

/**
 * The supply-chain install policy applied when a provider package is fetched.
 * Loading a provider runs its code, so the same controls the host applies to any
 * dependency apply here:
 *
 * - `ignoreScripts`     — disable package lifecycle (install) scripts.
 * - `minReleaseAgeDays` — refuse to install a version published more recently
 *                         than this many days ago (a typo-squat / compromised-
 *                         release guard).
 *
 * The CLI passes these to the package manager when adding a provider; this
 * module only declares them so the policy has one source of truth.
 */
export interface ProviderInstallPolicy {
  readonly ignoreScripts: boolean
  readonly minReleaseAgeDays: number
}

/**
 * The default install policy for provider packages: install scripts disabled,
 * and a seven-day minimum release age (matching the host npm/pnpm posture).
 */
export const DEFAULT_PROVIDER_INSTALL_POLICY: ProviderInstallPolicy = {
  ignoreScripts: true,
  minReleaseAgeDays: 7,
}

/**
 * A trust decision for one provider reference.
 *
 * - `ref`          — the reference as it appears in config.
 * - `origin`       — where it comes from.
 * - `trusted`      — whether it may be loaded under the active policy.
 * - `executesCode` — whether loading it runs external code (true for every
 *                    origin except `self`). Carried so the CLI can state plainly
 *                    that adding a provider runs code, never hiding it.
 */
export interface ProviderTrustDecision {
  readonly ref: string
  readonly origin: ProviderOrigin
  readonly trusted: boolean
  readonly executesCode: boolean
}

/**
 * Whether loading a provider of the given origin executes external code. Only
 * `self` (a developer-supplied in-repo stub the tool does not load as a package)
 * runs no external code; a local-path provider is still a module the tool
 * imports and executes.
 */
function originExecutesCode(origin: ProviderOrigin): boolean {
  return origin !== 'self'
}

/**
 * Classify a provider reference into a trust decision under the given policy.
 *
 * Trusted by origin: `self`, `first-party`, and `local`. A `third-party`
 * reference is trusted only if it appears on the policy allowlist — an explicit,
 * per-reference opt-in. The allowlist does not widen trust to any other
 * reference.
 */
export function classifyProviderRef(
  ref: string,
  policy: ProviderTrustPolicy = {},
): ProviderTrustDecision {
  const origin = providerOrigin(ref)
  const allowlisted = (policy.allowlist ?? []).includes(ref)
  const trusted = origin !== 'third-party' || allowlisted
  return {
    ref,
    origin,
    trusted,
    executesCode: originExecutesCode(origin),
  }
}

/**
 * Whether a provider reference is allowed to load under the given policy.
 */
export function isProviderRefAllowed(
  ref: string,
  policy: ProviderTrustPolicy = {},
): boolean {
  return classifyProviderRef(ref, policy).trusted
}

/**
 * The outcome of evaluating a set of provider references against the trust
 * policy. `ok` is true iff every reference is trusted; otherwise `untrusted`
 * lists the decisions the operator must allowlist (or remove) before loading.
 */
export type ProviderTrustOutcome =
  | { readonly ok: true; readonly decisions: readonly ProviderTrustDecision[] }
  | {
      readonly ok: false
      readonly decisions: readonly ProviderTrustDecision[]
      readonly untrusted: readonly ProviderTrustDecision[]
    }

/**
 * Evaluate every provider reference the config binds against the trust policy.
 * The discovery/loading path calls this before loading any provider module, so
 * an untrusted provider is rejected (or surfaced for opt-in) up front rather
 * than after its code has already run. Order of `refs` is preserved in the
 * decisions so the CLI reports them in config order.
 */
export function evaluateProviderTrust(
  refs: readonly string[],
  policy: ProviderTrustPolicy = {},
): ProviderTrustOutcome {
  const decisions = refs.map((ref) => classifyProviderRef(ref, policy))
  const untrusted = decisions.filter((decision) => !decision.trusted)
  if (untrusted.length > 0) {
    return { ok: false, decisions, untrusted }
  }
  return { ok: true, decisions }
}
