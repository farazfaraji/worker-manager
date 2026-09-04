import { IFunction } from "../abstracts/function.abstract";

export interface IncrementInput {
    value: any;
    amount?: number | string;
}

export class Increment implements IFunction<IncrementInput, { value: number }> {
    execute(data: IncrementInput): { value: number } {
        const rawValue = data?.value;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            throw new Error(`Increment execution failed: Variable value is required and must be a valid number (received: ${JSON.stringify(rawValue)})`);
        }

        const numValue = Number(rawValue);
        if (isNaN(numValue)) {
            throw new Error(`Increment execution failed: Variable value "${rawValue}" is not a valid number`);
        }

        const rawAmount = data?.amount !== undefined && data?.amount !== '' ? data.amount : 1;
        const numAmount = Number(rawAmount);
        if (isNaN(numAmount)) {
            throw new Error(`Increment execution failed: Increment amount "${rawAmount}" is not a valid number`);
        }

        const result = numValue + numAmount;
        return { value: result };
    }
}

export { Increment as IncrementVariable };
