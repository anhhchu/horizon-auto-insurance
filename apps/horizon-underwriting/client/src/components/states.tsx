import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@databricks/appkit-ui/react';
import { CircleAlert, Inbox } from 'lucide-react';

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="break-words">{message}</p>
        {onRetry && <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>Try again</Button>}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <Inbox />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function PageHeader({ title, description, meta }: { title: string; description?: string; meta?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="max-w-[65ch] space-y-1">
        <h1 className="hz-page-title">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{meta}</div>}
    </header>
  );
}
