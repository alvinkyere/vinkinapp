/**
 * Compile-time-only type-equality assertion, the standard `tsd`-style pattern (no runtime
 * code executes — this module only exists to be type-checked, per `tsc --noEmit` being the
 * "compile-time contract test" step of ENG2's verification). `Equal<A, B>` is the
 * conditional-types identity trick that also correctly rejects `any`.
 */

export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Used as `type _check = Expect<Equal<X, Y>>;` — a compile error here (not `true`) fails
 * `tsc --noEmit`, which is exactly the enforcement mechanism: no runtime assertion needed,
 * the type checker itself is the test. */
export type Expect<T extends true> = T;
