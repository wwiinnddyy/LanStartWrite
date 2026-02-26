declare module 'leafer-ui' {
  export class Leafer {
    constructor(...args: any[])
    [key: string]: any
  }

  export class Line {
    constructor(...args: any[])
    [key: string]: any
  }

  export class Polygon {
    constructor(...args: any[])
    [key: string]: any
  }
}

declare module 'perfect-freehand' {
  export function getStroke(points: number[][], options?: Record<string, unknown>): number[][]
}

declare module 'bun:sqlite' {
  export class Database {
    constructor(filename?: string, options?: { create?: boolean; readwrite?: boolean; readonly?: boolean })
    query(sql: string): {
      run(...params: unknown[]): unknown
      get(...params: unknown[]): unknown
      all(...params: unknown[]): unknown[]
    }
    exec(sql: string): void
    close(throwOnError?: boolean): void
  }
}
