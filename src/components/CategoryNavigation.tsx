
import React from 'react';
import { cn } from '@/lib/utils';
import { CategoryConfig } from '@/types/chronometer';
import { NavigationMenu, NavigationMenuList, NavigationMenuItem } from "@/components/ui/navigation-menu";

interface CategoryNavigationProps {
  categories: CategoryConfig[];
  activeCategory: string | null;
  onSelectCategory: (categoryId: string) => void;
}

const CategoryNavigation: React.FC<CategoryNavigationProps> = ({
  categories,
  activeCategory,
  onSelectCategory,
}) => {
  return (
    <NavigationMenu className="justify-center w-full my-4">
      <NavigationMenuList className="flex flex-wrap justify-center gap-2 px-4">
        {categories.map((category) => (
          <NavigationMenuItem key={category.id}>
            <button
              onClick={() => onSelectCategory(category.id)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                activeCategory === category.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              {category.name}
            </button>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
};

export default CategoryNavigation;
