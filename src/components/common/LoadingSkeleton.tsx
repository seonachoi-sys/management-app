import React from 'react';
import './LoadingSkeleton.css';

interface Props {
  type?: 'card' | 'table' | 'text';
  count?: number;
}

const LoadingSkeleton: React.FC<Props> = ({ type = 'card', count = 3 }) => {
  if (type === 'text') {
    return (
      <div className="skeleton-text-group">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="skeleton-text shimmer-sk" style={{ width: `${80 - i * 15}%` }} />
        ))}
      </div>
    );
  }

  if (type === 'table') {
    return (
      <div className="skeleton-table">
        <div className="skeleton-table-header shimmer-sk" />
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="skeleton-table-row shimmer-sk" />
        ))}
      </div>
    );
  }

  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card shimmer-sk" />
      ))}
    </div>
  );
};

export default LoadingSkeleton;
