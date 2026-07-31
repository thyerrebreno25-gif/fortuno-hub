export interface Parser<TContext, TResult> {
  id: string;
  version: string;
  detect(context: TContext): number;
  parse(context: TContext): TResult | Promise<TResult>;
}

export class ParserRegistry<TContext, TResult> {
  private readonly parsers: Parser<TContext, TResult>[] = [];

  register(parser: Parser<TContext, TResult>) {
    this.parsers.push(parser);
    return this;
  }

  ranked(context: TContext) {
    return this.parsers
      .map((parser) => ({ parser, confidence: parser.detect(context) }))
      .filter((candidate) => candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  resolve(context: TContext, minimumConfidence = 70) {
    const best = this.ranked(context)[0];
    if (!best || best.confidence < minimumConfidence) return null;
    return best;
  }
}
