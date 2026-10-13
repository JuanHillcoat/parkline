import type { UserSummary } from "../../../src/identity/application/use-cases/list-users";
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
  const roles = user.roles.map((role) => ROLE_LABELS[role]).join(", ") || "No role";
  return (
    <tr data-inactive={!user.active}>
      <th scope="row" className="cell-name">
        {user.displayName}
        {isSelf && " (you)"}
      </th>
      <td>{user.email}</td>
      <td>{roles}</td>
      <td>
        <span className={user.active ? "badge badge-ok" : "badge badge-neutral"}>
          {user.active ? "Active" : "Inactive"}
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
        <th scope="col">Name</th>
        <th scope="col">Email</th>
        <th scope="col">Role</th>
        <th scope="col">Status</th>
        <th scope="col"><span className="visually-hidden">Actions</span></th>
      </tr>
    </thead>
  );
}

export function UserTable({ users, selfId, canAssign, canDeactivate }: TableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">Users of this organization</caption>
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
