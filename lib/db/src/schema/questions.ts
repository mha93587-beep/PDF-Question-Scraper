import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const papersTable = pgTable("papers", {
  id: serial("id").primaryKey(),
  examName: text("exam_name").notNull(),
  year: text("year"),
  shift: text("shift"),
  totalQuestions: integer("total_questions").default(0),
  fileName: text("file_name"),
  processingStatus: text("processing_status").default("done"),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const questionsTable = pgTable("questions", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id").references(() => papersTable.id),
  questionNumber: integer("question_number").notNull(),
  questionIdOriginal: text("question_id_original"),
  questionText: text("question_text").notNull(),
  optionA: text("option_a"),
  optionB: text("option_b"),
  optionC: text("option_c"),
  optionD: text("option_d"),
  correctAnswer: text("correct_answer"),
  chosenOption: text("chosen_option"),
  status: text("status"),
  hasFigure: boolean("has_figure").default(false),
  figureData: text("figure_data"),
  subject: text("subject"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaperSchema = createInsertSchema(papersTable).omit({ id: true, createdAt: true });
export type InsertPaper = z.infer<typeof insertPaperSchema>;
export type Paper = typeof papersTable.$inferSelect;

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({ id: true, createdAt: true });
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;
