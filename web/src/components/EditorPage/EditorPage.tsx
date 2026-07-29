'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// Deep imports (not the package barrel) so the client bundle never pulls in
// gemini.ts's @google-cloud/vertexai dependency, which is Node-only (fs,
// child_process) and breaks the Next.js client build if imported here.
import { checkPlatformLength } from '@natsatopics/shared/lib/social/formatters';
import { SocialPlatform } from '@natsatopics/shared/lib/types';
import { getDraft, publishDraft, saveDraft, SafeDraft } from '@/lib/editorApiClient';
import { PlatformCharCounter } from '@/components/PlatformCharCounter/PlatformCharCounter';
import './EditorPage.scss';

const PLATFORMS: SocialPlatform[] = ['facebook', 'threads', 'bluesky'];

interface EditorPageProps {
  draftId: string;
  token: string;
  /** Pre-selects a specific draft option, e.g. when arriving via that
   * option's own magic link in the daily email rather than the generic
   * "open editor" link. */
  initialOptionId?: string;
}

/**
 * Vaihe 5 (Ihmisen tarkistus) UI: editor lands here from the magic-link
 * email, picks one of the three AI-generated options (or writes their own),
 * finalises the single cross-platform message with Tiptap, saves it, and
 * publishes it — which forks it to Facebook/Threads/Bluesky server-side.
 */
export function EditorPage({ draftId, token, initialOptionId }: EditorPageProps) {
  const [draft, setDraft] = useState<SafeDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [platformResults, setPlatformResults] = useState<Record<string, any> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
  });

  useEffect(() => {
    getDraft(draftId, token)
      .then(({ draft }) => {
        setDraft(draft);
        const matchedOption = initialOptionId ? draft.options.find((o) => o.id === initialOptionId) : undefined;
        const defaultOption = matchedOption ?? draft.options[0];
        setSelectedOptionId(defaultOption?.id ?? null);
        editor?.commands.setContent(draft.finalText ?? defaultOption?.text ?? '');
      })
      .catch((err) => setLoadError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, token]);

  const finalText = editor?.getText() ?? '';

  const charChecks = useMemo(
    () => PLATFORMS.map((platform) => ({ platform, ...checkPlatformLength(platform, finalText) })),
    [finalText]
  );

  function selectOption(optionId: string) {
    setSelectedOptionId(optionId);
    const option = draft?.options.find((o) => o.id === optionId);
    if (option) editor?.commands.setContent(option.text);
  }

  async function handleSave() {
    setSaveState('saving');
    try {
      await saveDraft(draftId, token, finalText, selectedOptionId ?? undefined);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function handlePublish() {
    setPublishState('publishing');
    setPublishError(null);
    try {
      await handleSave();
      const result = await publishDraft(draftId, token);
      setPlatformResults(result.platformPosts as Record<string, any>);
      setPublishState('done');
    } catch (err: any) {
      setPublishError(err.message);
      setPublishState('error');
    }
  }

  if (loadError) {
    return <div className="editor-page editor-page--error">Virhe: {loadError}</div>;
  }

  if (!draft) {
    return <div className="editor-page editor-page--loading">Ladataan luonnosta…</div>;
  }

  const alreadyHandled = draft.status !== 'pending_review';

  return (
    <div className="editor-page">
      <header className="editor-page__header">
        <h1>Natsastore — {draft.date}</h1>
        <span className={`editor-page__pillar editor-page__pillar--${draft.pillar}`}>{draft.pillar}</span>
      </header>

      {draft.sourceNews && (
        <p className="editor-page__source">
          Lähde: <a href={draft.sourceNews.url} target="_blank" rel="noreferrer">{draft.sourceNews.title}</a>
        </p>
      )}

      {alreadyHandled && (
        <div className="editor-page__banner">
          Tämä luonnos on jo tilassa &quot;{draft.status}&quot;. Muokkaus ja julkaisu on lukittu.
        </div>
      )}

      <section className="editor-page__options">
        <h2>Vaihtoehdot</h2>
        <div className="editor-page__option-grid">
          {draft.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={alreadyHandled}
              className={`editor-page__option ${selectedOptionId === option.id ? 'editor-page__option--active' : ''}`}
              onClick={() => selectOption(option.id)}
            >
              <span className="editor-page__option-template">Malli {option.template}</span>
              <p>{option.text}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="editor-page__final">
        <h2>Lopullinen viesti</h2>
        <div className="editor-page__tiptap">
          <EditorContent editor={editor} />
        </div>
        <div className="editor-page__counters">
          {charChecks.map((check) => (
            <PlatformCharCounter key={check.platform} {...check} />
          ))}
        </div>
      </section>

      <footer className="editor-page__actions">
        <button type="button" disabled={alreadyHandled || saveState === 'saving'} onClick={handleSave}>
          {saveState === 'saving' ? 'Tallennetaan…' : 'Tallenna'}
        </button>
        <button
          type="button"
          className="editor-page__publish"
          disabled={alreadyHandled || publishState === 'publishing'}
          onClick={handlePublish}
        >
          {publishState === 'publishing' ? 'Julkaistaan…' : 'Julkaise kaikkiin kanaviin'}
        </button>
      </footer>

      {saveState === 'error' && <p className="editor-page__error">Tallennus epäonnistui.</p>}
      {publishError && <p className="editor-page__error">Julkaisu epäonnistui: {publishError}</p>}

      {platformResults && (
        <section className="editor-page__results">
          <h2>Julkaisutulokset</h2>
          <ul>
            {Object.entries(platformResults).map(([platform, result]: [string, any]) => (
              <li key={platform} className={`editor-page__result editor-page__result--${result.status}`}>
                <strong>{platform}:</strong> {result.status}
                {result.error && <span> — {result.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
