import { err, ok, type Result } from "../../../shared/domain/result";
import type { RoleAssignment } from "../../domain/role-assignment";
import type { Session } from "../../domain/session";
import {
  DEFAULT_SIGN_IN_THROTTLE_POLICY,
  retryAfterSeconds,
  signInBlockedUntil,
  throttleWindowStart,
  type SignInThrottlePolicy,
} from "../../domain/sign-in-throttle-policy";
import { normalizeEmail, type User } from "../../domain/user";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { InvalidCredentialsError, TooManyAttemptsError } from "../errors";
import type { IdentityTx } from "../ports/identity-tx";
import type { ThrottleFailure, ThrottleSubject } from "../ports/sign-in-throttle";
import type { StoredUser } from "../ports/user-repository";

export type SignInInput = {
  readonly email: string;
  readonly password: string;
  /** Only pass an address the deployment trusts; null limits by email alone. */
  readonly clientAddress?: string | null;
};

export type SignInResult = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: User;
  readonly assignments: readonly RoleAssignment[];
};

type Attempt =
  | { readonly kind: "signed_in"; readonly result: SignInResult }
  | { readonly kind: "rejected" }
  | { readonly kind: "throttled"; readonly retryAfterSeconds: number };

const REJECTED: Attempt = { kind: "rejected" };

/** The subjects of one attempt: the email always, the address only when known. */
type Subjects = { readonly email: ThrottleSubject; readonly all: readonly ThrottleSubject[] };

type Context = { readonly subjects: Subjects; readonly failures: readonly ThrottleFailure[]; readonly now: Date };

const TIMING_PASSWORD = "parkline-timing-equalizer";

/**
 * A failed sign-in must still persist its audit entry and its throttle rows. The unit of work
 * rolls back on an err result, so a rejection (wrong credentials or throttled) is modelled as a
 * committed `ok` inside the transaction and mapped to its error only after commit.
 * Only a thrown infrastructure failure rolls the audit back.
 *
 * Subjects are SHA-256 digests (the same one-way hash used for session tokens) of the normalized
 * email and of the client address. Unknown emails are throttled exactly like known ones.
 */
export class SignIn {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly deps: IdentityDeps,
    private readonly throttlePolicy: SignInThrottlePolicy = DEFAULT_SIGN_IN_THROTTLE_POLICY,
  ) {}

  async execute(input: SignInInput): Promise<Result<SignInResult, InvalidCredentialsError | TooManyAttemptsError>> {
    const outcome = await this.deps.unitOfWork.run((tx) => this.attempt(tx, input));
    if (!outcome.ok || outcome.value.kind === "rejected") return err(new InvalidCredentialsError());
    const attempt = outcome.value;
    return attempt.kind === "throttled" ? err(new TooManyAttemptsError(attempt.retryAfterSeconds)) : ok(attempt.result);
  }

  private async attempt(tx: IdentityTx, input: SignInInput): Promise<Result<Attempt, never>> {
    const tenant = await tx.tenants.findSingle();
    if (tenant === null) {
      await this.checkCredentials(null, input.password);
      return ok(REJECTED);
    }
    const subjects = this.subjectsOf(input);
    const now = this.deps.clock.now();
    await tx.throttle.prune(tenant.id, throttleWindowStart(now, this.throttlePolicy));
    const failures = await tx.throttle.failuresSince(tenant.id, subjects.all, throttleWindowStart(now, this.throttlePolicy));
    const wait = this.waitSeconds(failures, subjects, now);
    if (wait !== null) return ok({ kind: "throttled", retryAfterSeconds: wait });
    return ok(await this.verify(tx, tenant.id, input, { subjects, failures, now }));
  }

  private async verify(tx: IdentityTx, tenantId: string, input: SignInInput, ctx: Context): Promise<Attempt> {
    const stored = await tx.users.findByEmail(tenantId, normalizeEmail(input.email));
    const user = await this.checkCredentials(stored, input.password);
    if (user === null) {
      await this.fail(tx, tenantId, stored?.user.id ?? null, ctx);
      return REJECTED;
    }
    await tx.throttle.clear(tenantId, ctx.subjects.email);
    return { kind: "signed_in", result: await this.open(tx, tenantId, user) };
  }

  private subjectsOf(input: SignInInput): Subjects {
    const hash = (value: string): string => this.deps.tokens.hash(value);
    const email: ThrottleSubject = { kind: "email", hash: hash(normalizeEmail(input.email)) };
    const address = input.clientAddress ?? null;
    return { email, all: address === null ? [email] : [email, { kind: "address", hash: hash(address) }] };
  }

  /** Seconds until the most restrictive blocked subject is free, or null when none is blocked. */
  private waitSeconds(failures: readonly ThrottleFailure[], subjects: Subjects, now: Date): number | null {
    const untils = subjects.all.map((subject) => this.blockedUntil(failures, subject, now));
    const blocked = untils.filter((until): until is Date => until !== null);
    if (blocked.length === 0) return null;
    return retryAfterSeconds(new Date(Math.max(...blocked.map((until) => until.getTime()))), now);
  }

  private blockedUntil(failures: readonly ThrottleFailure[], subject: ThrottleSubject, now: Date): Date | null {
    return signInBlockedUntil(this.failuresOf(failures, subject), this.limitOf(subject), now, this.throttlePolicy);
  }

  private failuresOf(failures: readonly ThrottleFailure[], subject: ThrottleSubject): Date[] {
    return failures.filter((f) => f.kind === subject.kind && f.hash === subject.hash).map((f) => f.at);
  }

  private limitOf(subject: ThrottleSubject): number {
    const { maxFailuresPerEmail, maxFailuresPerAddress } = this.throttlePolicy;
    return subject.kind === "email" ? maxFailuresPerEmail : maxFailuresPerAddress;
  }

  /** Records the failure, audits it, and audits a lock once when a subject first reaches its limit. */
  private async fail(tx: IdentityTx, tenantId: string, userId: string | null, ctx: Context): Promise<void> {
    await tx.throttle.recordFailure(tenantId, ctx.subjects.all, ctx.now);
    await this.audit(tx, tenantId, userId, "auth.sign_in_failed");
    const locks = ctx.subjects.all.some((s) => this.failuresOf(ctx.failures, s).length + 1 === this.limitOf(s));
    if (locks) await this.audit(tx, tenantId, userId, "auth.sign_in_locked");
  }

  /** Always runs one verify, against a dummy hash when the user is unknown, to equalize timing. */
  private async checkCredentials(stored: StoredUser | null, password: string): Promise<User | null> {
    const hash = stored?.passwordHash ?? (await this.dummy());
    const matches = await this.deps.hasher.verify(password, hash);
    return stored !== null && matches && stored.user.active ? stored.user : null;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(TIMING_PASSWORD);
    return this.dummyHash;
  }

  private async open(tx: IdentityTx, tenantId: string, user: User): Promise<SignInResult> {
    const assignments = await tx.assignments.listActiveByUser(tenantId, user.id);
    const { token, session } = this.newSession(tenantId, user.id);
    await tx.sessions.add(session);
    await recordAudit(tx, this.deps, {
      actorId: user.id,
      actorKind: "user",
      actorRole: assignments.map((a) => a.role).join(",") || "none",
      action: "auth.sign_in",
      entityType: "session",
      entityId: session.id,
      tenantId,
    });
    return { token, expiresAt: session.expiresAt, user, assignments };
  }

  /** Only the token hash is stored; the token goes back to the caller once. */
  private newSession(tenantId: string, userId: string): { token: string; session: Session } {
    const { clock, ids, tokens, policy } = this.deps;
    const issued = tokens.issue();
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + policy.absoluteSeconds * 1000);
    const session = {
      id: ids.next(),
      tenantId,
      userId,
      tokenHash: issued.tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
    };
    return { token: issued.token, session };
  }

  /** Never stores the attempted email, address or password. */
  private audit(tx: IdentityTx, tenantId: string, userId: string | null, action: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: userId ?? "anonymous",
      actorKind: userId === null ? "system" : "user",
      actorRole: "anonymous",
      action,
      entityType: "user",
      entityId: userId ?? "anonymous",
      tenantId,
    });
  }
}
