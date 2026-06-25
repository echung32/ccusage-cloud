import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import { getMe, requestLogin } from '@/lib/api';

type State = 'checking' | 'anon' | 'sent';

export function LoginGate() {
  const [state, setState] = useState<State>('checking');
  const [email, setEmail] = useState('');

  useEffect(() => {
    getMe().then(() => { if (typeof window !== 'undefined') window.location.href = '/overview'; }).catch(() => setState('anon'));
  }, []);

  async function submit() {
    try { await requestLogin(email); } catch { /* never reveal */ }
    setState('sent');
  }

  const Centered = ({ children }: { children: React.ReactNode }) => (
    <Box margin={{ top: 'xxxl' }}><div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div></Box>
  );

  if (state === 'checking') return <Centered><Box color="text-status-inactive">Loading…</Box></Centered>;
  if (state === 'sent') return (
    <Centered><Container header={<Header variant="h2">Check your inbox</Header>}>
      <Box>If your email is invited, a magic link is on its way.</Box>
    </Container></Centered>
  );
  return (
    <Centered>
      <Container header={<Header variant="h2">Sign in to ccusage-cloud</Header>}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Form actions={<Button variant="primary" formAction="none" onClick={submit}>Send magic link</Button>}>
            <FormField label="Email">
              <Input value={email} ariaLabel="email" type="email" placeholder="you@example.com"
                onChange={({ detail }) => setEmail(detail.value)} />
            </FormField>
          </Form>
        </form>
      </Container>
    </Centered>
  );
}
