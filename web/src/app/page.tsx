export default function HomePage() {
  return (
    <main style={{ padding: '3rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Natsastore sisältöpipeline</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Tämä sivusto ei ole julkinen etusivu. Editorit saapuvat tänne
        päivittäisen sähköpostin magic-linkin kautta osoitteessa
        <code> /editor/[draftId]?token=... </code>.
      </p>
    </main>
  );
}
