import { useEffect, useState } from 'react';
import { getMe, patchMe, createDevice, deleteDevice, logout } from '@/lib/api';
import type { Me } from '@/lib/types';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export function SettingsDevices() {
  const [me, setMe] = useState<Me | null>(null);
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  function refresh() { getMe().then(setMe).catch(() => setMe(null)); }
  useEffect(() => { refresh(); }, []);

  async function toggle(next: boolean) {
    await patchMe(next);
    refresh();
  }

  async function add() {
    if (!label.trim()) return;
    const { token } = await createDevice(label.trim());
    setNewToken(token);
    setLabel('');
    refresh();
  }

  async function revoke(id: string) {
    await deleteDevice(id);
    refresh();
  }

  return (
    <AppShell active="/settings">
      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Group sharing</CardTitle></CardHeader>
          <CardContent>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={me?.publicToGroup ?? false} onCheckedChange={(v) => toggle(Boolean(v))} />
              Share my usage with the group
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Devices</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {(me?.devices ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between">
                  <span>{d.label}{d.revokedAt ? ' (revoked)' : ''}</span>
                  {!d.revokedAt && <Button size="sm" variant="outline" onClick={() => revoke(d.id)}>Revoke</Button>}
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2">
              <label className="text-xs text-slate-500">
                New device
                <Input aria-label="new device label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop" />
              </label>
              <Button size="sm" onClick={add}>Add device</Button>
            </div>
            {newToken && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium">Copy this token now — it is shown only once:</p>
                <code className="break-all">{newToken}</code>
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="ghost" onClick={() => logout().then(() => { window.location.href = '/'; })}>Log out</Button>
      </div>
    </AppShell>
  );
}
