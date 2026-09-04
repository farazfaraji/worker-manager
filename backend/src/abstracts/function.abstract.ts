
export interface IFunction<TInput, TOutput> {
    execute(data: TInput): TOutput;
}
