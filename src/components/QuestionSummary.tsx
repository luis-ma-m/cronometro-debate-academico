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
import { useQuestionStats } from '@/hooks/useQuestionStats';
import { CategoryConfig, PositionType } from '@/types/chronometer';

interface QuestionSummaryProps {
  categoryId: string | undefined;
  side: 'favor' | 'contra' | undefined; // Keep side for consistency with request, though hook might not use it yet
  allCategories: CategoryConfig[];
}

const QuestionSummary: React.FC<QuestionSummaryProps> = ({ categoryId, side, allCategories }) => {
  const { total, answered } = useQuestionStats(categoryId, side, allCategories);

  if (total === 0) {
    return null; // Don't render if there are no questions relevant
  }

  return (
    <span className="text-xs text-muted-foreground">
      Preguntas: {answered}/{total}
    </span>
  );
};

export default QuestionSummary;

