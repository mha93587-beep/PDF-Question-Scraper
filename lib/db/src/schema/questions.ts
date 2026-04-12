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
  processingStage: text("processing_stage"),
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

export const batchJobsTable = pgTable("batch_jobs", {
  id: serial("id").primaryKey(),
  zipObjectPath: text("zip_object_path").notNull(),
  zipFileName: text("zip_file_name"),
  totalFiles: integer("total_files").default(0),
  processedFiles: integer("processed_files").default(0),
  failedFiles: integer("failed_files").default(0),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const batchItemsTable = pgTable("batch_items", {
  id: serial("id").primaryKey(),
  batchJobId: integer("batch_job_id").references(() => batchJobsTable.id),
  fileName: text("file_name").notNull(),
  paperId: integer("paper_id").references(() => papersTable.id),
  status: text("status").notNull().default("pending"),
  processingStage: text("processing_stage"),
  questionsExtracted: integer("questions_extracted").default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BatchJob = typeof batchJobsTable.$inferSelect;
export type BatchItem = typeof batchItemsTable.$inferSelect;

export const insertPaperSchema = createInsertSchema(papersTable).omit({ id: true, createdAt: true });
export type InsertPaper = z.infer<typeof insertPaperSchema>;
export type Paper = typeof papersTable.$inferSelect;

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({ id: true, createdAt: true });
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;
