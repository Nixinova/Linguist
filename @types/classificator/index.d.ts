export as namespace classificator;

export = Classificator;

declare function Classificator(options?: Classificator.Options): Classificator.NaiveBayes;

declare namespace Classificator {

    interface ClassificationResults {
        likelihoods: Array<{
            category: string,
            logLikelihood: number,
            logProba: number,
            proba: number,
        }>;
        predictedCategory: string;
    }

    interface Options {
        /**
         * Given an input string, tokenize it into an array of word tokens.
         *
         * By default, removes punctuation and splits on spaces.
         */
        tokenizer?: (text: string) => string[];

        /**
         * Alpha parameter of the additive smoothing operation.
         *
         * Defaults to `1`.
         */
        alpha?: number;

        /**
         * Defines how the prior probablity is calculated.
         *
         * If set to false, the classifier will use an uniform prior rather than a learnt one.
         *
         * Defaults to `true`.
         */
        fitPrior?: boolean;
    }

    /**
     * Naive-Bayes Classifier
     *
     * This is a naive-bayes classifier that uses Laplace Smoothing.
     *
     * Takes an (optional) options object containing:
     * - `tokenizer` => custom tokenization function
     */
    class NaiveBayes {
        constructor(options?: Classificator.Options);

        private options: Classificator.Options;
        private alpha: number;
        private fitPrior: boolean;
        private vocabulary: Record<string, number>;
        private vocabularySize: number;
        private totalDocuments: number;
        private docCount: Record<string, number>;
        private wordCount: Record<string, number>;
        private wordFrequencyCount: Record<string, Record<string, number>>;
        private categories: Record<string, boolean>;
        private tokenizer(text: string): string[];

        /**
         * Initialize each of data structure entry for a new category
         */
        private initializeCategory(category: string): Classificator.NaiveBayes;

        /**
         * Properly remove a category, unlearning all strings that were associated with it.
         */
        removeCategory(category: string): Classificator.NaiveBayes;

        /**
         * Train the naive Bayes classifier by telling it what `category` the `text` to add corresponds to.
         */
        learn(text: string, category: string): Classificator.NaiveBayes;

        /**
         * Untrain the naive Bayes classifier by telling it what `category` the `text` to remove corresponds to.
         */
        unlearn(text: string, category: string): Classificator.NaiveBayes;

        /**
         * Determine what category `text` belongs to.
         * @return predicted category and likelihoods stats.
         */
        categorize(text: string): Classificator.ClassificationResults;

        /**
         * Calculate the probability that the `token` belongs to a `category`
         * @return probability (0..1)
         */
        tokenProbability(token: string, category: string): number;

        /**
         * Build a frequency hashmap where:
         * - the keys are the entries in `tokens`
         * - the values are the frequency of each entry in `tokens`
         */
        frequencyTable(tokens: string[]): Record<string, number>;

        /**
         * Dump the classifier's state as a JSON string.
         * @return Representation of the classifier.
         */
        toJson(): string;

    }

    /**
     * Initializes a NaiveBayes instance from a JSON state representation.
     *
     * Use this with NaiveBayes::toJson().
     */
    function fromJson(jsonStrOrObject: string | object): Classificator.NaiveBayes;

    const STATE_KEYS: Readonly<string[]>;
}
