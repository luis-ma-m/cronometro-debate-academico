
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

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import CategoryForm from './CategoryForm';
import { EditableCategoryConfig, ValidationErrors, CategoryChangeField, CategoryChangeValue } from '@/types/configuration';

interface CategoryListProps {
  categories: EditableCategoryConfig[];
  validationErrors: ValidationErrors;
  onCategoryChange: (index: number, field: CategoryChangeField, value: CategoryChangeValue) => void;
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
