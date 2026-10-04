export type Subject = "chinese" | "english";

export type CardSource = "manual" | "bulk" | "ocr" | "builtin";

export type LearningCard = {
  id: string;
  familyId: string | null;
  subject: Subject;
  answerText: string;
  broadcastText: string;
  hintText: string | null;
  pinyinText: string | null;
  curriculumSource: "required_vocabulary" | "writing_practice" | null;
  sourceOrder: number | null;
  textbookEditionId: string | null;
  unitId: string | null;
  sectionId: string | null;
  source: CardSource;
};

export type CreateCardInput = {
  subject: Subject;
  answerText: string;
  broadcastText: string;
  hintText?: string;
  pinyinText?: string;
  curriculumSource?: "required_vocabulary" | "writing_practice";
  sourceOrder?: number;
  textbookEditionId?: string;
  unitId?: string;
  sectionId?: string;
  source: CardSource;
};

export type ParsedCard = Pick<
  LearningCard,
  "subject" | "answerText" | "broadcastText"
> & {
  sourceOrder: number;
};

export type ConfirmedCardInput = {
  lineId: string;
  answerText: string;
  broadcastText: string;
  hintText?: string;
};

export type CardFilter = {
  subject?: Subject;
  unitId?: string;
  query?: string;
};
