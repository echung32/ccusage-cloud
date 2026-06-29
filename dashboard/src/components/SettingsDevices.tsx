import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import Table from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import { getMe, patchMe, createDevice, deleteDevice, logout, createEnrollLink, renameDevice } from '@/lib/api';
import { buildInstallCommands } from '@/lib/install';
import type { Me, DeviceInfo, EnrollCode } from '@/lib/types';
import { AppShell } from '@/components/AppShell';

export function SettingsDevices() {
  const [me, setMe] = useState<Me | null>(null);
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<EnrollCode | null>(null);

  function refresh() { getMe().then(setMe).catch(() => setMe(null)); }
  useEffect(() => { refresh(); }, []);

  async function toggle(next: boolean) { await patchMe(next); refresh(); }
  async function add() {
    if (!label.trim()) return;
    const { token } = await createDevice(label.trim());
    setNewToken(token); setLabel(''); refresh();
  }
  async function revoke(id: string) { await deleteDevice(id); refresh(); }
  async function enrollLink() {
    setEnroll(await createEnrollLink());
  }

  const devices = me?.devices ?? [];

  return (
    <AppShell active="/settings">
      <ContentLayout header={<Header variant="h1">Settings</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Group sharing</Header>}>
            <Toggle checked={me?.publicToGroup ?? false} onChange={({ detail }) => toggle(detail.checked)}>
              Share my usage with the group
            </Toggle>
          </Container>
          <Container header={<Header variant="h2">Devices</Header>}>
            <SpaceBetween size="m">
              <Table variant="embedded" items={devices} trackBy="id"
                ariaLabels={{ activateEditLabel: () => 'Edit device name' }}
                submitEdit={async (item: DeviceInfo, _column, newValue) => {
                  const label = String(newValue).trim();
                  if (label) await renameDevice(item.id, label);
                  refresh();
                }}
                empty={<Box textAlign="center" color="inherit">No devices</Box>}
                columnDefinitions={[
                  {
                    id: 'label',
                    header: 'Device',
                    cell: (d: DeviceInfo) => (d.revokedAt ? `${d.label} (revoked)` : d.label),
                    editConfig: {
                      ariaLabel: 'Edit device name',
                      editIconAriaLabel: 'editable',
                      editingCell: (d: DeviceInfo, ctx: { currentValue: string | undefined; setValue: (v: string) => void }) => (
                        <Input autoFocus ariaLabel="device name input" value={ctx.currentValue ?? d.label}
                          onChange={({ detail }) => ctx.setValue(detail.value)} />
                      ),
                    },
                  },
                  { id: 'actions', header: '', cell: (d: DeviceInfo) => (d.revokedAt ? '—' : <Button onClick={() => revoke(d.id)}>Revoke</Button>) },
                ]} />
              <FormField label="New device">
                <SpaceBetween size="xs" direction="horizontal">
                  <Input value={label} ariaLabel="new device label" placeholder="laptop" onChange={({ detail }) => setLabel(detail.value)} />
                  <Button variant="primary" onClick={add}>Add device</Button>
                </SpaceBetween>
              </FormField>
              {newToken && (
                <Alert type="warning" header="Copy this token now — it is shown only once">
                  <Box variant="code">{newToken}</Box>
                </Alert>
              )}
              <FormField label="Enroll a new device with one command" description="Generates a one-time link (valid ~15 min) that registers the machine and syncs it.">
                <Button onClick={enrollLink}>Generate enroll command</Button>
              </FormField>
              {enroll && (
                <Alert type="info" header="Run one of these on the new machine">
                  <SpaceBetween size="xs">
                    <Box variant="awsui-key-label">Linux / macOS</Box>
                    <Box variant="code">{buildInstallCommands(window.location.origin, enroll.code).sh}</Box>
                    <Box variant="awsui-key-label">Windows (PowerShell)</Box>
                    <Box variant="code">{buildInstallCommands(window.location.origin, enroll.code).ps1}</Box>
                    <Box variant="small">Expires {new Date(enroll.expiresAt).toLocaleTimeString()} · single use.</Box>
                  </SpaceBetween>
                </Alert>
              )}
            </SpaceBetween>
          </Container>
          <Button variant="link" onClick={() => logout().then(() => { window.location.href = '/'; })}>Log out</Button>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
