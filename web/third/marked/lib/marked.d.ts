import type {ParseOptions} from "../../../src/markdown";

export class Renderer {
    code: (code: string) => string;
    link: (href: string, title: string, text: string) => void;
    br: () => string;
}

export type RegExpOrStub = RegExp | {
    exec: () => boolean;
};

type MarkedOptions = ParseOptions & {
    userMentionHandler: (mention: string, silently: boolean) => string | undefined;
    groupMentionHandler: (name: string, silently: boolean) => string | undefined;
    silencedMentionHandler: (quote: string) => string;
};

type MarkedStub = {
    (src: string, opt: MarkedOptions): string | undefined;
    Lexer: {
        rules: {
            tables: Record<string, RegExpOrStub>;
        };
    };
    InlineLexer: {
        rules: {
            zulip: Record<string, RegExpOrStub>;
        };
    };
    Renderer: typeof Renderer;
    stashHtml: (html: string, safe: boolean) => string;
};


declare const marked_stub: MarkedStub;
export default marked_stub;
