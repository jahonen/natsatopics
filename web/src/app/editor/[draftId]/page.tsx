import { EditorPage } from '@/components/EditorPage/EditorPage';

interface PageProps {
  params: { draftId: string };
  searchParams: { token?: string };
}

export default function DraftEditorRoute({ params, searchParams }: PageProps) {
  const token = searchParams.token ?? '';

  if (!token) {
    return (
      <main style={{ padding: '3rem', textAlign: 'center' }}>
        Puuttuva tai virheellinen linkki. Pyydä uusi linkki päivän sähköpostista.
      </main>
    );
  }

  return <EditorPage draftId={params.draftId} token={token} />;
}
