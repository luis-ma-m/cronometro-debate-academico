
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

