import { IFunction } from "../abstracts/function.abstract";

export class JsonParser implements IFunction<string, object> {
    execute(data: any): any {
        return JSON.parse(data)
    }
}