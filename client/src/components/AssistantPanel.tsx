import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { ChatTurn } from '../api/types';

const SUGGESTIONS = ['What is my checking balance?', 'How much did I spend on groceries this month?', 'Show my last five transactions'];

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => endRef.current?.scrollIntoView?.({ block: 'end' }), [turns, pending]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || pending) return;
    setError(undefined);
    setDraft('');
    const history = turns.slice(-10);
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setPending(true);
    try {
      const { reply } = await api.ask(text, history);
      setTurns((t) => [...t, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The assistant is unavailable right now.');
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <aside className="assistant" aria-label="Banking assistant">
      <header className="assistant-head">
        <div>
          <h2>Ask about your money</h2>
          <p className="muted">Answers come from your own accounts. The assistant can’t move money.</p>
        </div>
        <button type="button" className="button-quiet" onClick={onClose} aria-label="Close assistant">
          Close
        </button>
      </header>

      <div className="assistant-log" aria-live="polite">
        {turns.length === 0 && (
          <div className="assistant-suggestions">
            <p className="muted">Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble bubble-${t.role}`}>
            <span className="visually-hidden">{t.role === 'user' ? 'You said:' : 'Assistant:'}</span>
            {t.content}
          </div>
        ))}
        {pending && (
          <div className="bubble bubble-assistant bubble-pending" role="status">
            Looking at your accounts…
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="assistant-input" onSubmit={onSubmit}>
        <label htmlFor="assistant-message" className="visually-hidden">
          Your question
        </label>
        <input
          id="assistant-message"
          ref={inputRef}
          value={draft}
          maxLength={500}
          autoComplete="off"
          placeholder="Ask a question"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="button-primary" disabled={pending || !draft.trim()}>
          Ask
        </button>
      </form>
    </aside>
  );
}
