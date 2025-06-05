import $ from "jquery";
import assert from "minimalistic-assert";

import render_input_pill from "../templates/input_pill.hbs";
import render_search_list_item from "../templates/search_list_item.hbs";
import render_search_user_pill from "../templates/search_user_pill.hbs";

import * as blueslip from "./blueslip.ts";
import {Filter} from "./filter.ts";
import * as input_pill from "./input_pill.ts";
import type {InputPill, InputPillContainer} from "./input_pill.ts";
import * as people from "./people.ts";
import type {User} from "./people.ts";
import {type Suggestion, search_term_description_html} from "./search_suggestion.ts";
import type {NarrowTerm} from "./state_data.ts";
import * as stream_data from "./stream_data.ts";
import * as user_status from "./user_status.ts";
import type {UserStatusEmojiInfo} from "./user_status.ts";
import * as util from "./util.ts";

export type SearchUserPill = {
    type: "search_user";
    operator: string;
    negated: boolean;
    users: {
        full_name: string;
        user_id: number;
        email: string;
        img_src: string;
        status_emoji_info: UserStatusEmojiInfo | undefined;
        should_add_guest_user_indicator: boolean;
        deactivated: boolean;
    }[];
};

type SearchPill =
    | {
          type: "search_non_user";
          operator: string;
          operand: string;
          negated: boolean | undefined;
      }
    | SearchUserPill;

export type SearchPillWidget = InputPillContainer<SearchPill>;

export function create_item_from_search_string(search_string: string): SearchPill | undefined {
    const search_term = util.the(Filter.parse(search_string));
    if (!Filter.is_valid_search_term(search_term)) {
        // This will cause pill validation to fail and trigger a shake animation.
        return undefined;
    }
    return {
        type: "search_non_user",
        operator: search_term.operator,
        operand: search_term.operand,
        negated: search_term.negated,
    };
}

export function get_search_string_from_item(item: SearchPill): string {
    const sign = item.negated ? "-" : "";
    return `${sign}${item.operator}: ${get_search_operand(item, true)}`;
}

// This is called when the a pill is closed. We have custom logic here
// because group user pills have pills inside of them, and it's possible
// to e.g. remove a user from a group-DM pill without deleting the whole
// DM pill.
function on_pill_exit(
    clicked_element: HTMLElement,
    all_pills: InputPill<SearchPill>[],
    remove_pill: (pill: HTMLElement) => void,
): void {
    const $user_pill_container = $(clicked_element).parents(".user-pill-container");
    if ($user_pill_container.length === 0) {
        // This is just a regular search pill, so we don't need to do fancy logic.
        const $clicked_pill = $(clicked_element).closest(".pill");
        remove_pill(util.the($clicked_pill));
        return;
    }
    // The user-pill-container container class is used exclusively for
    // group-DM search pills, where multiple user pills sit inside a larger
    // pill. The exit icons in those individual user pills should remove
    // just that pill, not the outer pill.
    const user_id_string = $(clicked_element).closest(".pill").attr("data-user-id");
    assert(user_id_string !== undefined);
    const user_id = Number.parseInt(user_id_string, 10);

    // First get the outer pill that contains the user pills.
    const outer_idx = all_pills.findIndex((pill) => pill.$element[0] === $user_pill_container[0]);
    assert(outer_idx !== -1);
    const user_container_pill = all_pills[outer_idx]!.item;
    assert(user_container_pill?.type === "search_user");

    // If there's only one user in this pill, delete the whole pill.
    if (user_container_pill.users.length === 1) {
        assert(util.the(user_container_pill.users).user_id === user_id);
        remove_pill(util.the($user_pill_container));
        return;
    }

    // Remove the user id from the pill data.
    const user_idx = user_container_pill.users.findIndex((user) => user.user_id === user_id);
    assert(user_idx !== -1);
    user_container_pill.users.splice(user_idx, 1);

    // Remove the user pill from the DOM.
    const $outer_container = all_pills[outer_idx]!.$element;
    const $user_pill = $($outer_container.children(".pill")[user_idx]!);
    assert($user_pill.attr("data-user-id") === user_id.toString());
    $user_pill.remove();
}

// TODO(evy): One problem is we're not highlighting the query text
// in user pills that are displayed at the very end of search
// suggestions, and we might want to still do that, but if so we'll
// need to reshape some logic to get that set up. I've started a
// conversation about it on CZO:
// https://chat.zulip.org/#narrow/channel/101-design/topic/search.20typeahead.20highlighting/near/2187269
function search_user_pill_data_from_term(term: NarrowTerm): SearchUserPill {
    const emails = term.operand.split(",");
    const users = emails.map((email) => {
        const person = people.get_by_email(email);
        assert(person !== undefined);
        return person;
    });
    return search_user_pill_data(users, term.operator, term.negated ?? false);
}

const user_pill_description_html_by_operand = new Map([
    ["dm", "Direct message conversation"],
    ["sender", "Who sent the message"],
    ["dm-including", "Conversation participant"],
]);

// TODO: We're calculating `description_html` every time, even though
// we only show it (in `generate_pills_html`) for lines with only one
// pill. We can probably simplify things by separating out a function
// that generates `description_html` from the information in a single
// search pill, and remove `description_html` from the `Suggestion` type.
export function generate_pills_html(suggestion: Suggestion): string {
    const search_terms = Filter.parse(suggestion.search_string);

    const pills: SearchPill[] = search_terms.map((term) => {
        if (user_pill_operators.has(term.operator) && term.operand !== "") {
            return search_user_pill_data_from_term(term);
        }
        return {
            type: "search_non_user",
            operator: term.operator,
            operand: term.operand,
            negated: term.negated,
        };
    });

    const pill_render_data = pills.map((item) => {
        if (item.type === "search_user") {
            return item;
        }
        if (item.operator === "topic" && item.operand === "") {
            return {
                ...item,
                is_empty_string_topic: true,
                sign: item.negated ? "-" : "",
                topic_display_name: util.get_final_topic_display_name(""),
            };
        }
        if (item.operator === "search") {
            return {
                ...item,
                description_html: search_term_description_html(item),
            };
        }
        return {
            ...item,
            display_value: get_search_string_from_item(item),
        };
    });

    // We show help text (description_html) only when there's just a
    // single pill on that suggstion line.
    if (pills.length === 1) {
        const pill = util.the(pills);
        let description_html;
        // We don't need to add description html for search terms,
        // since those "pills" are already set up to only display
        // text and no pill.
        if (pill.type === "search_non_user" && pill.operator !== "search") {
            description_html = suggestion.description_html;
        } else if (pill.type === "search_user") {
            description_html = user_pill_description_html_by_operand.get(pill.operator);
            if (description_html === undefined) {
                blueslip.warn("unexpected user pill operator: " + pill.operator);
            }
        }
        return render_search_list_item({
            pills: pill_render_data,
            description_html,
        });
    }

    return render_search_list_item({
        pills: pill_render_data,
    });
}

export function create_pills($pill_container: JQuery): SearchPillWidget {
    const pills = input_pill.create({
        $container: $pill_container,
        create_item_from_text: create_item_from_search_string,
        get_text_from_item: get_search_string_from_item,
        split_text_on_comma: false,
        convert_to_pill_on_enter: false,
        generate_pill_html(item) {
            if (item.type === "search_user") {
                return render_search_user_pill(item);
            }
            if (item.operator === "topic" && item.operand === "") {
                return render_input_pill({
                    is_empty_string_topic: true,
                    sign: item.negated ? "-" : "",
                    topic_display_name: util.get_final_topic_display_name(""),
                });
            }
            const display_value = get_search_string_from_item(item);
            return render_input_pill({
                display_value,
            });
        },
        get_display_value_from_item: get_search_string_from_item,
        on_pill_exit,
    });
    // We don't automatically create pills on paste. When the user
    // presses enter, we validate the input then.
    pills.createPillonPaste(() => false);
    return pills;
}

function search_user_pill_data(users: User[], operator: string, negated: boolean): SearchUserPill {
    return {
        type: "search_user",
        operator,
        negated,
        users: users.map((user) => ({
            full_name: user.full_name,
            user_id: user.user_id,
            email: user.email,
            img_src: people.small_avatar_url_for_person(user),
            status_emoji_info: user_status.get_status_emoji(user.user_id),
            should_add_guest_user_indicator: people.should_add_guest_user_indicator(user.user_id),
            deactivated: !people.is_person_active(user.user_id) && !user.is_inaccessible_user,
        })),
    };
}

function append_user_pill(
    users: User[],
    pill_widget: SearchPillWidget,
    operator: string,
    negated: boolean,
): void {
    const pill_data = search_user_pill_data(users, operator, negated);
    pill_widget.appendValidatedData(pill_data);
    pill_widget.clear_text();
}

const user_pill_operators = new Set(["dm", "dm-including", "sender"]);

export function set_search_bar_contents(
    search_terms: NarrowTerm[],
    pill_widget: SearchPillWidget,
    is_typeahead_visible: boolean,
    set_search_bar_text: (text: string) => void,
): void {
    pill_widget.clear(true);
    let partial_pill = "";
    const invalid_inputs = [];
    const search_operator_strings = [];

    for (const term of search_terms) {
        const input = Filter.unparse([term]);

        // If the last term looks something like `dm:`, we
        // don't want to make it a pill, since it isn't isn't
        // a complete search term yet.
        // Instead, we keep the partial pill to the end of the
        // search box as text input, which will update the
        // typeahead to show operand suggestions.
        // Note: We make a pill for `topic:` as it represents empty string topic
        // except the case where it suggests `topic` operator.
        if (
            input.at(-1) === ":" &&
            term.operand === "" &&
            term === search_terms.at(-1) &&
            (term.operator !== "topic" ||
                (is_typeahead_visible &&
                    $("#searchbox_form .typeahead-item.active .empty-topic-display").length === 0))
        ) {
            partial_pill = input;
            continue;
        }

        if (!Filter.is_valid_search_term(term)) {
            invalid_inputs.push(input);
            continue;
        }

        if (user_pill_operators.has(term.operator) && term.operand !== "") {
            const users = term.operand.split(",").map((email) => {
                // This is definitely not undefined, because we just validated it
                // with `Filter.is_valid_search_term`.
                const user = people.get_by_email(email)!;
                return user;
            });
            append_user_pill(users, pill_widget, term.operator, term.negated ?? false);
        } else if (term.operator === "search") {
            search_operator_strings.push(input);
        } else {
            pill_widget.appendValue(input);
        }
    }
    pill_widget.clear_text();

    const search_bar_text_strings = [...search_operator_strings, ...invalid_inputs];
    if (partial_pill !== "") {
        search_bar_text_strings.push(partial_pill);
    }
    set_search_bar_text(search_bar_text_strings.join(" "));
    if (invalid_inputs.length > 0) {
        $("#search_query").addClass("shake");
    }
}

function get_search_operand(item: SearchPill, for_display: boolean): string {
    if (item.type === "search_user") {
        return item.users.map((user) => user.email).join(",");
    }
    if (for_display && item.operator === "channel" && item.operand !== "") {
        return stream_data.get_valid_sub_by_id_string(item.operand).name;
    }
    if (for_display && item.operator === "topic") {
        return util.get_final_topic_display_name(item.operand);
    }
    return item.operand;
}

export function get_current_search_pill_terms(pill_widget: SearchPillWidget): NarrowTerm[] {
    return pill_widget.items().map((item) => ({
        ...item,
        operand: get_search_operand(item, false),
    }));
}
