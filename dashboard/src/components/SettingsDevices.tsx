import { useEffect, useState, type FormEvent } from "react";
import {
  getMe,
  createDevice,
  deleteDevice,
  logout,
  createEnrollLink,
  renameDevice,
} from "@/lib/api";
import { buildInstallCommands } from "@/lib/install";
import type { Me, EnrollCode } from "@/lib/types";
import { AppShell } from "./AppShell";
import { PageHeading, Panel, LoadingState, ErrorState, EmptyState } from "./ui";

export function SettingsDevices() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<EnrollCode | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setMe(await getMe());
  }
  useEffect(() => {
    let current = true;
    getMe()
      .then((data) => {
        if (current) setMe(data);
      })
      .catch(() => {
        if (current)
          setError("Unable to load your account. Please reload this page.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch {
      setError("Unable to complete this action. Please try again.");
    } finally {
      setPending(false);
    }
  }
  function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    void perform(async () => {
      const result = await createDevice(label.trim());
      setNewToken(result.token);
      setLabel("");
      await refresh();
    });
  }
  function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editLabel.trim()) return;
    void perform(async () => {
      await renameDevice(editing, editLabel.trim());
      setEditing(null);
      await refresh();
    });
  }
  const commands =
    enroll && typeof window !== "undefined"
      ? buildInstallCommands(window.location.origin, enroll.code)
      : null;
  return (
    <AppShell active="/settings">
      <PageHeading
        title="Make yourself at home."
        description="Connect your devices and manage your personal workspace."
      />
      <div className="stack">
        {error && <ErrorState message={error} />}
        {loading ? (
          <LoadingState />
        ) : (
          <div className="settings-grid">
            <div className="stack">
              <Panel
                title="Your devices"
                description="Manage the machines that sync usage to your account."
              >
                {!me?.devices.length && (
                  <EmptyState
                    title="No devices"
                    description="Add a device below or generate an enrollment command."
                  />
                )}
                {me?.devices.map((d) => (
                  <div className="device-row" key={d.id}>
                    <div>
                      {editing === d.id ? (
                        <form className="inline-form" onSubmit={rename}>
                          <input
                            autoFocus
                            aria-label="device name input"
                            value={editLabel}
                            maxLength={100}
                            onChange={(e) => setEditLabel(e.target.value)}
                          />
                          <button
                            className="button button-primary"
                            disabled={pending || !editLabel.trim()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <h3>
                            {d.label}{" "}
                            {d.revokedAt && (
                              <span className="tag">Revoked</span>
                            )}
                          </h3>
                          <p>
                            {d.lastSeenAt
                              ? `Last synced ${new Date(d.lastSeenAt).toLocaleString()}`
                              : "Waiting for first sync"}
                          </p>
                        </>
                      )}
                    </div>
                    {!d.revokedAt && editing !== d.id && (
                      <div className="device-actions">
                        <button
                          className="button button-quiet"
                          aria-label={`Edit ${d.label}`}
                          disabled={pending}
                          onClick={() => {
                            setEditing(d.id);
                            setEditLabel(d.label);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="button button-danger"
                          disabled={pending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke ${d.label}? This device will no longer be able to sync.`,
                              )
                            )
                              void perform(async () => {
                                await deleteDevice(d.id);
                                await refresh();
                              });
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <form onSubmit={add}>
                  <label className="field">
                    New device
                    <div className="inline-form">
                      <input
                        aria-label="new device label"
                        placeholder="e.g. Work laptop"
                        value={label}
                        maxLength={100}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                      <button
                        className="button button-primary"
                        disabled={pending || !label.trim()}
                      >
                        Add device
                      </button>
                    </div>
                  </label>
                </form>
                {newToken && (
                  <div
                    className="alert alert-warning"
                    style={{ marginTop: 20 }}
                  >
                    <strong>Copy this token now — it is shown only once</strong>
                    <code className="secret">{newToken}</code>
                    <button
                      className="button"
                      onClick={() => setNewToken(null)}
                    >
                      Dismiss token
                    </button>
                  </div>
                )}
              </Panel>
              <Panel
                title="Connect with one command"
                description="Generate a single-use enrollment command, valid for about 15 minutes. It registers the machine and syncs your usage."
              >
                <button
                  className="button button-primary"
                  disabled={pending}
                  onClick={() =>
                    void perform(async () => {
                      setEnroll(await createEnrollLink());
                    })
                  }
                >
                  Generate enroll command
                </button>
                {enroll && commands && (
                  <div style={{ marginTop: 20 }}>
                    <p className="field-note">
                      Run one of these on the new machine.
                    </p>
                    <label className="field">
                      Linux / macOS<code className="secret">{commands.sh}</code>
                    </label>
                    <label className="field">
                      Windows (PowerShell)
                      <code className="secret">{commands.ps1}</code>
                    </label>
                    <p className="field-note">
                      Expires {new Date(enroll.expiresAt).toLocaleTimeString()}{" "}
                      · single use.
                    </p>
                    <button
                      className="button button-quiet"
                      onClick={() => setEnroll(null)}
                    >
                      Dismiss commands
                    </button>
                  </div>
                )}
              </Panel>
            </div>
            <div className="stack">
              <Panel title="Personal account">
                <p className="account-email">{me?.email ?? "Your account"}</p>
                <span className="tag">Private workspace</span>
                <p className="field-note" style={{ margin: "20px 0" }}>
                  Your usage is private. Only you can view your projects,
                  sessions, and device activity.
                </p>
                <button
                  className="button"
                  disabled={pending}
                  onClick={() =>
                    void perform(async () => {
                      await logout();
                      window.location.href = "/";
                    })
                  }
                >
                  Log out
                </button>
              </Panel>
              <Panel title="How syncing works">
                <p className="field-note">
                  The CLI reads usage from your local AI tools and sends it to
                  this workspace. Device tokens are unique to each machine;
                  revoke one at any time to stop its access.
                </p>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
