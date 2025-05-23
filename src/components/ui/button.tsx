// src/components/ui/button.tsx
import React from 'react';

export type ButtonVariant = 'default' | 'outline' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'md',
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

    // Variant styles
    let variantStyles = '';
    switch (variant) {
      case 'destructive':
        variantStyles =
          'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500';
        break;
      case 'outline':
        variantStyles =
          'border border-gray-300 bg-white hover:bg-gray-100 focus:ring-gray-500';
        break;
      case 'ghost':
        variantStyles =
          'bg-transparent hover:bg-gray-100 text-gray-700 focus:ring-gray-500';
        break;
      default:
        variantStyles =
          'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500';
    }

    // Size styles
    let sizeStyles = '';
    switch (size) {
      case 'sm':
        sizeStyles = 'px-2 py-1 text-sm';
        break;
      case 'lg':
        sizeStyles = 'px-4 py-2 text-base';
        break;
      case 'icon':
        // square button just for icons
        sizeStyles = 'p-2 w-8 h-8';
        break;
      default:
        // md
        sizeStyles = 'px-3 py-2 text-sm';
    }

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
