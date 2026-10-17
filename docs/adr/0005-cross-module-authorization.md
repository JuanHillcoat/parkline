# 0005. Cross-module authorization

- Status: Accepted
- Date: 2026-10-17
- Feature: p0-04
- Source: [`eslint.architecture.mjs`](../../eslint.architecture.mjs), [`src/README.md`](../../src/README.md); decision D1 in [`odd/tasks/p0-04-organization.md`](../../odd/tasks/p0-04-organization.md); builds on [ADR-0001](0001-hexagonal-modular-monolith.md) and [ADR-0003](0003-identity-and-sessions.md)

## Context

Roles and scopes live in `identity`. The new `organization` module must authorize its use cases against them (`catalog.read`, `catalog.write`, over a business unit, operation or site). The architecture rules forbid one module's `domain` and `application` from importing another module, and `shared-domain` may import only `shared-domain`. `organization` therefore cannot call `requirePermission` or `authorize`.

## Decision

- **Port in the shared kernel.** `src/shared/domain/ports/access-policy.ts` defines `Actor`, `Grant`, `ResourcePosition` and `AccessPolicy.check(actor, permission, resource): Result<string, DomainError>`. The `string` is the granting role, which goes into the audit entry as `actorRole`. Permission and role are plain strings there: the kernel does not know identity's vocabulary.
- **Identity implements it.** `IdentityAccessPolicy` (in `identity/application`) validates the strings against `PERMISSIONS` and `parseRole`, rebuilds identity's assignments from the grants and calls the same `authorizeRole` that `requirePermission` uses. There is one implementation of the rules; unknown permissions, roles or scope types deny.
- **Grants travel with the actor.** `Actor` carries an opaque, read-only `grants` list (`role`, `scopeType`, `scopeId`) plus `active`. `toActor(ActorContext)` builds it from the data `AuthenticateSession` already loads (active assignments of the user). Alternative considered: the policy loads assignments through a read port on each check. Rejected because it adds a query per check and a database dependency to a pure decision; the cost is that grants are a snapshot of the request, which is the same freshness `ActorContext` already has.
- **Errors.** `ForbiddenError` moves to the shared kernel; identity re-exports the same class, so existing `instanceof` checks and the code `forbidden` do not change. Inactive-user and tenant-mismatch errors stay in identity and travel as `DomainError`.
- **Wiring.** `container.ts` builds `IdentityAccessPolicy` and exposes it as `accessPolicy`. Later modules receive it as a dependency.
- **No behavior change.** `requirePermission` now delegates to `authorizeRole`; its results are the same except that the forbidden message is the more precise one of `authorize`.
- **Cost.** No dependency or service: $0.

## Alternatives considered

- **Catalogs inside `identity`.** No port needed, but identity would own business units, operations and sites, mixing two bounded contexts and growing a module whose subject is people and access. Rejected.
- **Relaxing the lint rule** to let `organization` import identity's domain. It removes the guarantee that modules only meet through shared ports and sets a precedent every module would use. Rejected; the rules stay untouched.

## Consequences

- Positive: `organization` depends on a small port and can be tested with an in-memory policy; identity keeps the only copy of the authorization rules.
- Positive: lint proves the direction (boundary tests cover a shared-domain file importing a module and a module importing identity).
- Open risk: `Grant` fields are strings, so a typo in a role or scope type is caught at runtime (it denies), not by the compiler.
- Open risk: grants are a snapshot taken at authentication of the request. A role revoked during the same request is not seen.
- Open risk: `ResourcePosition` repeats the shape of identity's `ResourceScope`; they must evolve together (a new hierarchy level touches both).
