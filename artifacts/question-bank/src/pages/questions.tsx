import { useState } from "react";
import { useListQuestions, useListPapers, getListQuestionsQueryKey, getListPapersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, ImageIcon, CheckCircle2, Filter, X } from "lucide-react";

export default function QuestionsPage() {
  const [paperId, setPaperId] = useState<number | undefined>(undefined);
  const [hasFigure, setHasFigure] = useState<boolean | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const params = {
    ...(paperId !== undefined && { paperId }),
    ...(hasFigure !== undefined && { hasFigure }),
  };

  const { data: questions, isLoading } = useListQuestions(params, {
    query: { queryKey: getListQuestionsQueryKey(params) },
  });

  const { data: papers } = useListPapers({
    query: { queryKey: getListPapersQueryKey() },
  });

  const clearFilters = () => {
    setPaperId(undefined);
    setHasFigure(undefined);
  };

  const hasActiveFilters = paperId !== undefined || hasFigure !== undefined;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Question Bank</h1>
          <p className="text-muted-foreground text-lg">Browse and filter all extracted questions.</p>
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="w-4 h-4 mr-2" />
          Filters
          {hasActiveFilters && <Badge className="ml-2" variant="secondary">Active</Badge>}
        </Button>
      </div>

      {showFilters && (
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-2 min-w-[200px]">
                <Label>Paper</Label>
                <select
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                  value={paperId || ""}
                  onChange={(e) => setPaperId(e.target.value ? parseInt(e.target.value) : undefined)}
                >
                  <option value="">All Papers</option>
                  {papers?.map((p) => (
                    <option key={p.id} value={p.id}>{p.examName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 min-w-[200px]">
                <Label>Has Figure</Label>
                <select
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                  value={hasFigure === undefined ? "" : hasFigure ? "true" : "false"}
                  onChange={(e) => setHasFigure(e.target.value === "" ? undefined : e.target.value === "true")}
                >
                  <option value="">All</option>
                  <option value="true">With Figures</option>
                  <option value="false">Without Figures</option>
                </select>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-sm text-muted-foreground">
        {questions ? `${questions.length} questions found` : "Loading..."}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : questions && questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((q) => (
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
                  </div>
                  {q.correctAnswer && (
                    <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {q.correctAnswer}
                    </Badge>
                  )}
                </div>

                <p className="text-foreground mb-3 leading-relaxed">{q.questionText}</p>

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
                        className={`flex items-start gap-2 p-2.5 rounded-md border text-sm ${
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
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-lg font-medium">No questions found</p>
            <p className="text-sm">Try adjusting your filters or upload a paper first.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
