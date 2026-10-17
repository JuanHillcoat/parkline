import type { UserSummary } from "../../../src/identity/application/use-cases/list-users";
import { copy } from "../../_lib/copy";
import { ROLE_LABELS } from "../../_lib/messages";
import { ChangeRoleDialog, DeactivateDialog } from "./user-dialogs";

type RowProps = {
  readonly user: UserSummary;
  readonly isSelf: boolean;
  readonly canAssign: boolean;
  readonly canDeactivate: boolean;
};

function RowActions({ user, isSelf, canAssign, canDeactivate }: RowProps) {
  if (!user.active) return null;
  const target = { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null };
  return (
    <span className="row-actions">
      {canAssign && <ChangeRoleDialog target={target} />}
      {canDeactivate && !isSelf && <DeactivateDialog target={target} />}
    </span>
  );
}

function UserRow(props: RowProps) {
  const { user, isSelf } = props;
  const roles = user.roles.map((role) => ROLE_LABELS[role]).join(", ") || copy.common.noRole;
  return (
    <tr data-inactive={!user.active}>
      <th scope="row" className="cell-name">
        {user.displayName}
        {isSelf && ` ${copy.common.you}`}
      </th>
      <td>{user.email}</td>
      <td>{roles}</td>
      <td>
        <span className={user.active ? "badge badge-ok" : "badge badge-neutral"}>
          {user.active ? copy.common.active : copy.common.inactive}
        </span>
      </td>
      <td className="cell-actions"><RowActions {...props} /></td>
    </tr>
  );
}

type TableProps = {
  readonly users: readonly UserSummary[];
  readonly selfId: string;
  readonly canAssign: boolean;
  readonly canDeactivate: boolean;
};

function TableHead() {
  return (
    <thead>
      <tr>
        <th scope="col">{copy.users.columns.name}</th>
        <th scope="col">{copy.users.columns.email}</th>
        <th scope="col">{copy.users.columns.role}</th>
        <th scope="col">{copy.users.columns.status}</th>
        <th scope="col"><span className="visually-hidden">{copy.users.columns.actions}</span></th>
      </tr>
    </thead>
  );
}

export function UserTable({ users, selfId, canAssign, canDeactivate }: TableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{copy.users.tableCaption}</caption>
        <TableHead />
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} isSelf={user.id === selfId}
              canAssign={canAssign} canDeactivate={canDeactivate} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
