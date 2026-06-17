export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// Maps each question text to the user's chosen answer (labels joined for multi-select, or free text for "Other")

export type Asker = (
  questions: Question[],
) => Promise<
  Record<string /** question text */, string /** user;s chosen answer */>
>;

// Structured multiple-choice question tool 
