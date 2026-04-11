import { useGetPaper, useGetPaperQuestions, getGetPaperQueryKey, getGetPaperQuestionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft, Loader2, ImageIcon, CheckCircle2 } from "lucide-react";

export default function PaperDetailPage({ id }: { id: string }) {
  const paperId = parseInt(id, 10);

  const { data: paper, isLoading: paperLoading } = useGetPaper(paperId, {
    query: { enabled: !isNaN(paperId), queryKey: getGetPaperQueryKey(paperId) },
  });

  const { data: questions, isLoading: questionsLoading } = useGetPaperQuestions(paperId, {
    query: { enabled: !isNaN(paperId), queryKey: getGetPaperQuestionsQueryKey(paperId) },
  });

  if (paperLoading || questionsLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/papers">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{paper?.examName || "Paper"}</h1>
          <p className="text-muted-foreground">
            {paper?.year && `Year: ${paper.year}`}
            {paper?.shift && ` | ${paper.shift}`}
            {` | ${paper?.totalQuestions || 0} questions`}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {questions?.map((q) => (
          <Card key={q.id} className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">Q.{q.questionNumber}</Badge>
                  {q.hasFigure && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> Figure
                    </Badge>
                  )}
                  {q.questionIdOriginal && (
                    <span className="text-xs text-muted-foreground">ID: {q.questionIdOriginal}</span>
                  )}
                </div>
                {q.correctAnswer && (
                  <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Answer: {q.correctAnswer}
                  </Badge>
                )}
              </div>

              <p className="text-foreground mb-4 leading-relaxed">{q.questionText}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  { label: "A", value: q.optionA },
                  { label: "B", value: q.optionB },
                  { label: "C", value: q.optionC },
                  { label: "D", value: q.optionD },
                ].map((opt) =>
                  opt.value ? (
                    <div
                      key={opt.label}
                      className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                        q.correctAnswer === opt.label
                          ? "border-green-300 bg-green-50 text-green-900"
                          : "border-border bg-card"
                      }`}
                    >
                      <span className="font-semibold shrink-0">{opt.label}.</span>
                      <span>{opt.value}</span>
                    </div>
                  ) : null
                )}
              </div>

              {q.note && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  Note: {q.note}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
