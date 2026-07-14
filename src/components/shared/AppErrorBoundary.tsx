import { Component, type ErrorInfo, type ReactNode } from "react";
import { getLastBootStep, logDiagnostic, type DiagnosticType } from "@/lib/desktopErrorLogger";

type Props = { children: ReactNode };
type State = { error: Error | null };

function componentNameFromStack(componentStack?: string | null): string {
  const firstComponent = componentStack
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at "));
  return firstComponent?.replace(/^at\s+/, "").split(/[\s(]/, 1)[0] || "desconhecido";
}

export function reportAppError(
  originalError: unknown,
  componentStack?: string | null,
  source = "React ErrorBoundary",
  type: DiagnosticType | string = "react-error-boundary",
) {
  const error =
    originalError instanceof Error
      ? originalError
      : new Error(typeof originalError === "string" ? originalError : String(originalError));

  console.error(`[${source}] Excecao nao tratada`, {
    originalError,
    originalMessage: error.message,
    errorName: error.name,
    fullStack: error.stack ?? "stack indisponivel",
    componentStack: componentStack || "componentStack indisponivel",
    throwingComponent: componentNameFromStack(componentStack),
    cause: error.cause,
  });

  void logDiagnostic({
    type,
    error,
    componentStack,
    additional: {
      source,
      throwingComponent: componentNameFromStack(componentStack),
      route: typeof window !== "undefined" ? window.location.pathname : null,
      lastBootStep: getLastBootStep(),
    },
  });
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportAppError(
      error,
      info.componentStack,
      "AppErrorBoundary.componentDidCatch",
      "react-error-boundary",
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
