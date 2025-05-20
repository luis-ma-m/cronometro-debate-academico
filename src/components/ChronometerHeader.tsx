
import React from 'react';

interface ChronometerHeaderProps {
  logoUrl: string;
  h1Text: string;
}

const ChronometerHeader: React.FC<ChronometerHeaderProps> = ({ logoUrl, h1Text }) => {
  return (
    <header className="text-center py-8">
      {logoUrl && (
        <img 
          src={logoUrl} 
          alt="Logo del debate" 
          className="mx-auto h-20 w-auto mb-4 object-contain"
          onError={(e) => (e.currentTarget.src = '/placeholder.svg')} // Fallback
        />
      )}
      <h1 className="text-4xl font-bold text-foreground">{h1Text}</h1>
    </header>
  );
};

export default ChronometerHeader;
