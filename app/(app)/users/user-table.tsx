import type { UserSummary } from "../../../src/identity/application/use-cases/list-users";
import { copy } from "../../_lib/copy";
import { grantText, type ScopeOptions } from "../../_lib/user-scope";
import { ChangeRoleDialog, DeactivateDialog } from "./user-dialogs";

type RowProps = {
  readonly user: UserSummary;
  readonly isSelf: boolean;
  readonly canAssign: boolean;
  readonly canDeactivate: boolean;
  readonly options: ScopeOptions;
};

function RowActions({ user, isSelf, canAssign, canDeactivate, options }: RowProps) {
  if (!user.active) return null;
  const grant = user.grants[0];
  const target = {
    id: user.id,
    displayName: user.displayName,
    role: grant?.role ?? null,
    scopeType: grant?.scopeType ?? "tenant",
    scopeId: grant?.scopeId ?? "",
  };
  return (
    <span className="row-actions">
      {canAssign && <ChangeRoleDialog target={target} options={options} />}
      {canDeactivate && !isSelf && <DeactivateDialog target={target} />}
    </span>
  );
}

function UserRow(props: RowProps) {
  const { user, isSelf } = props;
  const roles = user.grants.map(grantText).join(", ") || copy.common.noRole;
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
  readonly options: ScopeOptions;
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

export function UserTable({ users, selfId, canAssign, canDeactivate, options }: TableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{copy.users.tableCaption}</caption>
        <TableHead />
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} isSelf={user.id === selfId}
              canAssign={canAssign} canDeactivate={canDeactivate} options={options} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
