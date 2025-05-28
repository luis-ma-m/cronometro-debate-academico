
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import CategoryForm from './CategoryForm';
import { EditableCategoryConfig, ValidationErrors } from '@/types/configuration';
import { CategoryType } from '@/types/chronometer';

interface CategoryListProps {
  categories: EditableCategoryConfig[];
  validationErrors: ValidationErrors;
  onCategoryChange: (index: number, field: keyof EditableCategoryConfig | 'categoryType', value: string | boolean | CategoryType) => void;
  onAddCategory: () => void;
  onDeleteCategory: (index: number) => void;
}

const CategoryList: React.FC<CategoryListProps> = ({
  categories,
  validationErrors,
  onCategoryChange,
  onAddCategory,
  onDeleteCategory,
}) => {
  return (
    <>
      <div className="flex justify-between items-center mt-6 mb-2">
        <h3 className="font-semibold text-lg">Turnos</h3>
        <Button variant="outline" size="sm" onClick={onAddCategory}>
          <PlusCircle className="mr-2 h-4 w-4" /> Añadir turno
        </Button>
      </div>
      <div className="space-y-3">
        {categories.map((category, index) => (
          <CategoryForm
            key={category.id || `cat-${index}`}
            category={category}
            index={index}
            validationErrors={validationErrors}
            onCategoryChange={onCategoryChange}
            onDeleteCategory={onDeleteCategory}
          />
        ))}
      </div>
    </>
  );
};

export default CategoryList;
