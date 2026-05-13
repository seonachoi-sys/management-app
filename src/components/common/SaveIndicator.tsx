import React, { useState, useCallback, createContext, useContext } from 'react';
import './SaveIndicator.css';

interface SaveContextValue {
  showSaved: () => void;
  showSaving: () => void;
}

const SaveContext = createContext<SaveContextValue>({ showSaved: () => {}, showSaving: () => {} });

export function useSaveIndicator() {
  return useContext(SaveContext);
}

export const SaveIndicatorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const showSaving = useCallback(() => setStatus('saving'), []);
  const showSaved = useCallback(() => {
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2000);
  }, []);

  return (
    <SaveContext.Provider value={{ showSaved, showSaving }}>
      {children}
      {status !== 'idle' && (
        <div className={`save-indicator ${status}`}>
          {status === 'saving' ? (
            <><span className="save-spinner" /> 저장 중...</>
          ) : (
            <>✓ 저장됨</>
          )}
        </div>
      )}
    </SaveContext.Provider>
  );
};
