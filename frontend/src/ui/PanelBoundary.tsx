/**
 * Keeps one failing panel from blanking the whole page: the panel shows what
 * went wrong and a way out, and the globe and everything else keep working.
 */
import { Component, type ReactNode } from "react";

import { useStore } from "../app/store";

interface Props {
  name: string;
  children: ReactNode;
}

export class PanelBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`EarthPulse: the ${this.props.name} panel failed`, error);
  }

  reset = () => {
    // Drop the result that could not be shown, so the panel can draw again.
    useStore.getState().set({ result: null, selectedStory: null, pendingRun: null });
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const body = encodeURIComponent(`The ${this.props.name} panel stopped with:\n\n    ${this.state.error.message}\n\nWhat I was doing:\n`);
    return (
      <aside className="panel right" role="alert">
        <div className="panel-body">
          <section>
            <h2 className="story-title">This panel ran into a problem</h2>
            <p className="muted">{this.state.error.message}</p>
            <p>The globe and the rest of the app still work. You can clear this panel and carry on.</p>
            <div className="row-actions">
              <button className="primary" onClick={this.reset}>Clear and continue</button>
              <a className="button" href={`https://github.com/moosarazauaf/earthpulse/issues/new?labels=bug&title=${encodeURIComponent(`Panel error: ${this.state.error.message.slice(0, 80)}`)}&body=${body}`}
                target="_blank" rel="noopener noreferrer">Report it</a>
            </div>
          </section>
        </div>
      </aside>
    );
  }
}
