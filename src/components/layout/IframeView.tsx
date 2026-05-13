import React from 'react';

interface IframeViewProps {
  src: string;
  title: string;
}

const IframeView: React.FC<IframeViewProps> = ({ src, title }) => {
  return (
    <div className="tool-view">
      <iframe src={src} title={title} className="tool-iframe" />
    </div>
  );
};

export default IframeView;
