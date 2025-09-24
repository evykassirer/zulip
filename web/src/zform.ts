import $ from "jquery";
import type * as z from "zod/mini";

import render_widgets_zform_choices from "../templates/widgets/zform_choices.hbs";

import * as blueslip from "./blueslip.ts";
import type {Message} from "./message_store.ts";
import type {Event} from "./poll_widget.ts";
import {zform_widget_extra_data_schema} from "./submessage.ts";
import * as transmit from "./transmit.ts";
import type {WidgetExtraData} from "./widgetize.ts";

export type ZFormExtraData = z.infer<typeof zform_widget_extra_data_schema>;

export function activate(opts: {
    $elem: JQuery;
    extra_data: WidgetExtraData;
    message: Message;
}): (events: Event[]) => void {
    const $outer_elem = opts.$elem;
    const data = zform_widget_extra_data_schema.parse(opts.extra_data);

    function make_choices(data: ZFormExtraData): JQuery {
        // Assign idx values to each of our choices so that
        // our template can create data-idx values for our
        // JS code to use later.
        const data_with_choices_with_idx = {
            ...data,
            choices: data.choices.map((choice, idx) => ({...choice, idx})),
        };

        const html = render_widgets_zform_choices(data_with_choices_with_idx);
        const $elem = $(html);

        $elem.find("button").on("click", (e) => {
            e.stopPropagation();

            // Grab our index from the markup.
            const idx = Number.parseInt($(e.target).attr("data-idx")!, 10);

            // Use the index from the markup to dereference our
            // data structure.
            const reply_content = data.choices[idx]!.reply;

            transmit.reply_message({
                message: opts.message,
                content: reply_content,
            });
        });

        return $elem;
    }

    function render(): void {
        if (data.type === "choices") {
            $outer_elem.html(make_choices(data).html());
        }
    }

    const handle_events = function (events: Event[]): void {
        if (events) {
            blueslip.info("unexpected");
        }
        render();
    };

    render();

    return handle_events;
}
