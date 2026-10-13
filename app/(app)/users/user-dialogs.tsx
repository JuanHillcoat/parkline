import { ROLES, type Role } from "../../../src/identity/domain/role";
import { MIN_PASSWORD_LENGTH } from "../../../src/identity/domain/password-policy";
import { ActionDialog } from "../../_components/action-dialog";
import { ROLE_LABELS } from "../../_lib/messages";
import { changeRoleAction, createUserAction, deactivateUserAction } from "./actions";

function RoleSelect({ id, current }: { id: string; current: Role }) {
  return (
    <div className="field">
      <label htmlFor={id}>Role</label>
      <select id={id} name="role" defaultValue={current} className="input">
        {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
      </select>
    </div>
  );
}

function ReasonField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>Reason</label>
      <textarea id={id} name="reason" required rows={3} placeholder={placeholder} className="input" />
      <span className="hint">Required. It is recorded in the audit log.</span>
    </div>
  );
}

function TextField(props: { id: string; name: string; label: string; type?: string; placeholder: string }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} name={props.name} type={props.type ?? "text"} required
        placeholder={props.placeholder} className="input" autoComplete="off" />
    </div>
  );
}

export function NewUserDialog() {
  return (
    <ActionDialog triggerLabel="New user" triggerClassName="btn btn-primary" title="New user"
      description="They can sign in with the email and the initial password you set."
      submitLabel="Create user" action={createUserAction}>
      <TextField id="new-name" name="displayName" label="Display name" placeholder="Full name" />
      <TextField id="new-email" name="email" label="Email" type="email" placeholder="name@example.com" />
      <TextField id="new-password" name="password" label="Initial password" type="password"
        placeholder={`At least ${String(MIN_PASSWORD_LENGTH)} characters`} />
      <p className="hint">
        At least {MIN_PASSWORD_LENGTH} characters. Share it through a secure channel.
      </p>
      <RoleSelect id="new-role" current="viewer" />
    </ActionDialog>
  );
}

type Target = { readonly id: string; readonly displayName: string; readonly role: Role | null };

export function ChangeRoleDialog({ target }: { target: Target }) {
  return (
    <ActionDialog triggerLabel="Change role" triggerClassName="btn btn-link" title="Change role"
      description={`${target.displayName} will lose the permissions of the previous role.`}
      submitLabel="Save role" action={changeRoleAction}>
      <input type="hidden" name="userId" value={target.id} />
      <RoleSelect id={`role-${target.id}`} current={target.role ?? "viewer"} />
      <p className="hint">Only tenant scope is available for now.</p>
      <ReasonField id={`reason-role-${target.id}`} placeholder="Why is the role changing?" />
    </ActionDialog>
  );
}

export function DeactivateDialog({ target }: { target: Target }) {
  return (
    <ActionDialog triggerLabel="Deactivate" triggerClassName="btn btn-link btn-link-danger"
      title={`Deactivate ${target.displayName}?`} danger submitLabel="Deactivate user"
      description="They will be signed out everywhere and will not be able to sign in again until reactivated."
      action={deactivateUserAction}>
      <input type="hidden" name="userId" value={target.id} />
      <ReasonField id={`reason-off-${target.id}`} placeholder="Why is this user being deactivated?" />
    </ActionDialog>
  );
}
