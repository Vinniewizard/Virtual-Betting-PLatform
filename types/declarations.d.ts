declare module 'router';
declare module 'finalhandler';
declare module 'jsonwebtoken';
declare module 'bcrypt';

declare module 'node:sqlite' {
    export class DatabaseSync {
        constructor(location: string, options?: any);
        location(): string;
        exec(sql: string): void;
        prepare(sql: string): StatementSync;
    }
    export class StatementSync {
        run(...args: any[]): void;
        get(...args: any[]): any;
        all(...args: any[]): any[];
    }
}
