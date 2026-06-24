import { useEffect, useState } from 'react';
import { getMe, requestLogin } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type State = 'checking' | 'anon' | 'sent';

export function LoginGate() {
  const [state, setState] = useState<State>('checking');
  const [email, setEmail] = useState('');

  useEffect(() => {
    getMe()
      .then(() => {
        if (typeof window !== 'undefined') window.location.href = '/overview';
      })
      .catch(() => setState('anon'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await requestLogin(email); } catch { /* never reveal */ }
    setState('sent');
  }

  if (state === 'checking') return <p className="p-8 text-slate-500">Loading…</p>;
  if (state === 'sent') {
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <Card>
          <CardHeader><CardTitle>Check your inbox</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-slate-600">If your email is invited, a magic link is on its way.</p></CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-24 max-w-sm">
      <Card>
        <CardHeader><CardTitle>Sign in to ccusage-cloud</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input aria-label="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit">Send magic link</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
