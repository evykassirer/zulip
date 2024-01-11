import type {ParseOptions} from "./markdown";

export class Renderer {
    code: (code: string) => string;
    link: (href: string, title: string, text: string) => void;
    br: () => string;
}

type RegExpOrStub = RegExp | (() => boolean);

type MarkedOptions = ParseOptions & {
    userMentionHandler: (mention: string, silently: boolean) => string | undefined;
    groupMentionHandler: (name: string, silently: boolean) => string | undefined;
    silencedMentionHandler: (quote: string) => string;
};

type MarkedStub = {
    (): (src: string, opt: MarkedOptions) => string | undefined;
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
    Renderer: Renderer;
    stashHtml: (html: string, safe: boolean) => string;
};

declare module "web/third/marked/lib/marked" {
    const marked_stub: MarkedStub;
    export = marked_stub;
}
