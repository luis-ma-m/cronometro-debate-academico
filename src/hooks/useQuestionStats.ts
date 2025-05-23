
import { useMemo } from 'react';
import { CategoryConfig, Question } from '@/types/chronometer';

export const useQuestionStats = (
  categoryId: string | undefined,
  _side: 'favor' | 'contra' | undefined, // side might be used later if questions are split
  allCategories: CategoryConfig[]
) => {
  const stats = useMemo(() => {
    if (!categoryId) {
      return { total: 0, answered: 0 };
    }

    const category = allCategories.find(cat => cat.id === categoryId);
    const questions = category?.questions;

    if (!questions || !Array.isArray(questions)) {
      return { total: 0, answered: 0 };
    }

    const total = questions.length;
    const answered = questions.filter(q => q.answered).length;

    return { total, answered };
  }, [categoryId, _side, allCategories]); // _side included for future-proofing if behavior changes

  return stats;
};

