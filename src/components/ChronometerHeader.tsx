
import React from 'react';

interface ChronometerHeaderProps {
  logoUrl: string;
  h1Text: string;
}

const ChronometerHeader: React.FC<ChronometerHeaderProps> = ({ logoUrl, h1Text }) => {
  return (
    <header className="text-center py-8">
      {logoUrl && ( // This check is important. If logoUrl can be an empty string from settings, it won't render.
        <img 
          src={logoUrl} 
          alt="Logo del debate" 
          className="mx-auto h-20 w-auto mb-4 object-contain"
          onError={(e) => {
            // Attempt to set placeholder only if current src is not already placeholder
            // to avoid infinite loop if placeholder itself fails
            if (e.currentTarget.src !== '/placeholder.svg') {
                 e.currentTarget.src = '/placeholder.svg';
            }
            e.currentTarget.alt = "Logo no disponible"; // Update alt text on error
          }}
        />
      )}
      <h1 className="text-4xl font-bold text-foreground">{h1Text}</h1>
    </header>
  );
};

export default ChronometerHeader;
