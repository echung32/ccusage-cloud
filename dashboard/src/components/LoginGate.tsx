import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import { getMe } from '@/lib/api';

type State = 'checking' | 'denied';

export function LoginGate() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    getMe()
      .then(() => { window.location.href = '/overview'; })
      // On 401 the api client has already redirected to the gateway. If we got
      // here it's a non-redirecting failure or the returned=1 guard fired →
      // show the terminal not-authorized state.
      .catch(() => {
        const returned = new URL(window.location.href).searchParams.get('returned') === '1';
        if (returned) setState('denied');
      });
  }, []);

  const Centered = ({ children }: { children: React.ReactNode }) => (
    <Box margin={{ top: 'xxxl' }}><div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div></Box>
  );

  if (state === 'denied') {
    return (
      <Centered>
        <Container header={<Header variant="h2">Not authorized</Header>}>
          <Box>Your account isn't permitted to access this app. Contact the owner if you think this is a mistake.</Box>
        </Container>
      </Centered>
    );
  }
  return <Centered><Box color="text-status-inactive">Redirecting to sign in…</Box></Centered>;
}
