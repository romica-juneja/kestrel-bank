import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** Runs an async loader whenever `deps` change, ignoring results from stale calls. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const callId = useRef(0);

  useEffect(() => {
    const id = ++callId.current;
    setLoading(true);
    setError(undefined);
    loader()
      .then((d) => id === callId.current && setData(d))
      .catch((e) => id === callId.current && setError(e instanceof ApiError ? e : new ApiError(0, 'unknown_error', String(e))))
      .finally(() => id === callId.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
