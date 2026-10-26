import type {
  RiskClassifier,
  RiskClassifierInput,
  RiskClassifierResult,
} from '../../src/core/safety/classifier.js';

export class FakeRiskClassifier implements RiskClassifier {
  readonly calls: RiskClassifierInput[] = [];
  private readonly results: Array<RiskClassifierResult | Error>;

  constructor(results: Array<RiskClassifierResult | Error>) {
    this.results = [...results];
  }

  async classify(input: RiskClassifierInput): Promise<RiskClassifierResult> {
    this.calls.push(input);
    const result = this.results.shift();
    if (result === undefined) {
      return { ok: false, errorCode: 'NO_SCRIPT' };
    }
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
}
