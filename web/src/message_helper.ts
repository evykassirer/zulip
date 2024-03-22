import _ from "lodash";

import * as alert_words from "./alert_words";
import * as message_store from "./message_store";
import type {Message, MessageWithBooleans, RawMessage} from "./message_store";
import * as message_user_ids from "./message_user_ids";
import * as people from "./people";
import * as pm_conversations from "./pm_conversations";
import * as recent_senders from "./recent_senders";
import * as stream_data from "./stream_data";
import * as stream_topic_history from "./stream_topic_history";
import * as util from "./util";

export function process_new_message(message: RawMessage): Message {
    // Call this function when processing a new message.  After
    // a message is processed and inserted into the message store
    // cache, most modules use message_store.get to look at
    // messages.
    const cached_msg = message_store.get_cached_message(message.id);
    if (cached_msg !== undefined) {
        // Copy the match topic and content over if they exist on
        // the new message
        if (util.get_match_topic(message) !== undefined) {
            util.set_match_data(cached_msg, message);
        }
        return cached_msg;
    }

    const booleans = message_store.get_message_booleans(message);
    const message_with_booleans: MessageWithBooleans = {
        ...message,
        ...booleans,
    };
    people.extract_people_from_message(message_with_booleans);

    const sent_by_me = people.is_current_user(message_with_booleans.sender_email);
    people.maybe_incr_recipient_count({
        ...message_with_booleans,
        sent_by_me,
    });

    const sender = people.maybe_get_user_by_id(message_with_booleans.sender_id);
    if (sender) {
        message.sender_full_name = sender.full_name;
        message.sender_email = sender.email;
        // is this not used anywhere?
        // message.status_emoji_info = user_status.get_status_emoji(message.sender_id);
    }

    let full_message: Message;
    let topic;
    switch (message_with_booleans.type) {
        case "stream":
            topic = util.get_message_topic(message);
            stream_topic_history.add_message({
                stream_id: message_with_booleans.stream_id,
                topic_name: topic,
                message_id: message.id,
            });
            recent_senders.process_stream_message({
                ...message_with_booleans,
                topic,
            });
            message_user_ids.add_user_id(message.sender_id);
            full_message = {
                ..._.omit(message_with_booleans, "flags"),
                sent_by_me,
                reactions: message.reactions ?? [],
                is_stream: true,
                is_private: false,
                reply_to: message.sender_email,
                topic,
                stream: stream_data.get_stream_name_from_id(message_with_booleans.stream_id),
            };
            break;

        case "private":
            full_message = {
                ..._.omit(message_with_booleans, "flags"),
                type: "private",
                sent_by_me,
                reply_to: util.normalize_recipients(message_store.get_pm_emails(message)),
                reactions: message.reactions ?? [],
                is_stream: false,
                is_private: true,
                display_reply_to: message_store.get_pm_full_names(message),
                pm_with_url: people.pm_with_url(message)!,
                to_user_ids: people.pm_reply_user_string(message)!,
            };
            pm_conversations.process_message(full_message);

            recent_senders.process_private_message(full_message);
            if (people.is_my_user_id(message.sender_id)) {
                for (const recip of message.display_recipient) {
                    message_user_ids.add_user_id(recip.id);
                }
            }

            break;
    }

    alert_words.process_message(full_message);
    message_store.update_message_cache(full_message);
    return full_message;
}
