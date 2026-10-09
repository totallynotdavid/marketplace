import type { Role, SessionUser } from "../env.ts";
import { Layout, PostButton, formatTime } from "./layout.tsx";

export type UserRow = { id: string; email: string; role: Role; active: number; created_at: number };
export type AuditRow = {
  id: number;
  admin_email: string;
  action: string;
  target: string;
  created_at: number;
};

export function UsersPage(props: { user: SessionUser; users: UserRow[] }) {
  return (
    <Layout title="Users" user={props.user}>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.users.map((u) => (
            <tr>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.active ? "active" : "deactivated"}</td>
              <td>{formatTime(u.created_at)}</td>
              <td>
                {u.active && u.role !== "admin" && (
                  <PostButton action={`/admin/users/${u.id}/deactivate`} label="Deactivate" />
                )}
                {!u.active && (
                  <PostButton action={`/admin/users/${u.id}/reactivate`} label="Reactivate" />
                )}{" "}
                <PostButton action={`/admin/users/${u.id}/reset`} label="Reset link" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

export function ResetLinkPage(props: { user: SessionUser; email: string; url: string }) {
  return (
    <Layout title="Password reset link" user={props.user}>
      <p>
        Give this link to {props.email}. It works once, for one hour, and is not shown again.
        Opening it signs them out everywhere.
      </p>
      <p>
        <code>{props.url}</code>
      </p>
      <p>
        <a href="/admin/users">Back to users</a>
      </p>
    </Layout>
  );
}

export function AuditPage(props: { user: SessionUser; rows: AuditRow[] }) {
  return (
    <Layout title="Audit log" user={props.user}>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr>
              <td>{formatTime(r.created_at)}</td>
              <td>{r.admin_email}</td>
              <td>{r.action}</td>
              <td>
                <code>{r.target}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
