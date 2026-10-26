import type { ReactNode } from 'react';

export function ErrorNotice({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <p>{children}</p>
      {onRetry && (
        <button type="button" className="button-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
