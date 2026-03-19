import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[ErrorBoundary]", error, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-6 text-center text-status-error">
          <h3>Something went wrong</h3>
          <p className="opacity-70">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })} className="mt-3 px-4 py-2 border border-border rounded-md bg-transparent text-inherit cursor-pointer hover:bg-muted transition">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
