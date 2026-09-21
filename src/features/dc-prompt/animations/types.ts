export interface PromptAnimation {
  readonly name: string;
  render(tick: number): string;
}
