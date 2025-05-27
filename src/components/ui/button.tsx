
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default:
          'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
        destructive:
          'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
        outline:
          'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
        ghost:
          'bg-transparent hover:bg-gray-100 text-gray-700 focus:ring-gray-500',
      },
      size: {
        sm: 'px-2 py-1 text-sm',
        md: 'px-3 py-2 text-sm',
        lg: 'px-4 py-2 text-base',
        icon: 'p-2 w-8 h-8', // Adjusted for consistency, original had w-8 h-8 in switch
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
// Note: Removed ButtonVariant and ButtonSize types as VariantProps infers them.

