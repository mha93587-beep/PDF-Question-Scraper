import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import UploadPage from "@/pages/upload";
import BatchUploadPage from "@/pages/batch-upload";
import PapersPage from "@/pages/papers";
import PaperDetailPage from "@/pages/paper-detail";
import QuestionsPage from "@/pages/questions";
import AiExtractPage from "@/pages/ai-extract";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/upload" component={UploadPage} />
        <Route path="/batch" component={BatchUploadPage} />
        <Route path="/papers" component={PapersPage} />
        <Route path="/papers/:id">
          {(params) => <PaperDetailPage id={params.id} />}
        </Route>
        <Route path="/questions" component={QuestionsPage} />
        <Route path="/ai-extract" component={AiExtractPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
