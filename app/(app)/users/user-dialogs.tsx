import { ROLES, type Role } from "../../../src/identity/domain/role";
import { MIN_PASSWORD_LENGTH } from "../../../src/identity/domain/password-policy";
import { ActionDialog } from "../../_components/action-dialog";
import { copy } from "../../_lib/copy";
import { ROLE_LABELS } from "../../_lib/messages";
import { changeRoleAction, createUserAction, deactivateUserAction } from "./actions";

function RoleSelect({ id, current }: { id: string; current: Role }) {
  return (
    <div className="field">
      <label htmlFor={id}>{copy.common.role}</label>
      <select id={id} name="role" defaultValue={current} className="input">
        {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
      </select>
    </div>
  );
}

function ReasonField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{copy.common.reason}</label>
      <textarea id={id} name="reason" required rows={3} placeholder={placeholder} className="input" />
      <span className="hint">{copy.common.reasonHint}</span>
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
  const t = copy.dialogs.newUser;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createUserAction}>
      <TextField id="new-name" name="displayName" label={t.nameLabel} placeholder={t.namePlaceholder} />
      <TextField id="new-email" name="email" label={t.emailLabel} type="email"
        placeholder={t.emailPlaceholder} />
      <TextField id="new-password" name="password" label={t.passwordLabel} type="password"
        placeholder={t.passwordPlaceholder(MIN_PASSWORD_LENGTH)} />
      <p className="hint">{t.passwordHint(MIN_PASSWORD_LENGTH)}</p>
      <RoleSelect id="new-role" current="viewer" />
    </ActionDialog>
  );
}

type Target = { readonly id: string; readonly displayName: string; readonly role: Role | null };

export function ChangeRoleDialog({ target }: { target: Target }) {
  const t = copy.dialogs.changeRole;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title}
      description={t.description(target.displayName)} submitLabel={t.submit} action={changeRoleAction}>
      <input type="hidden" name="userId" value={target.id} />
      <RoleSelect id={`role-${target.id}`} current={target.role ?? "viewer"} />
      <p className="hint">{t.scopeHint}</p>
      <ReasonField id={`reason-role-${target.id}`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

export function DeactivateDialog({ target }: { target: Target }) {
  const t = copy.dialogs.deactivate;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link btn-link-danger"
      title={t.title(target.displayName)} danger submitLabel={t.submit}
      description={t.description} action={deactivateUserAction}>
      <input type="hidden" name="userId" value={target.id} />
      <ReasonField id={`reason-off-${target.id}`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
