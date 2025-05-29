/**
 * MIT License
 * Copyright (c) 2025 Luis Martín Maíllo
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

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
