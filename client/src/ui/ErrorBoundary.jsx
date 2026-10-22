import { Component } from 'react';

/** Keeps one failed asset from blanking the whole app. Shows a readable message instead. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[scene] failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="lobby">
        <h1>The house isn’t ready yet</h1>
        <p className="lede">Something failed to load. Refresh to try again.</p>
        <p className="error">{String(this.state.error?.message ?? this.state.error)}</p>
      </main>
    );
  }
}
