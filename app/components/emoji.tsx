import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { Model } from "../store";

// Elinor's mark: a geometric "E" monogram, in the same flat/rounded-bar
// language as the rest of the declutter pass, rather than a generic
// third-party robot glyph. currentColor so it follows the avatar's own
// color handling (light/dark, no-dark override) exactly like the icon it
// replaces did.
function ElinorMark(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="3" height="16" rx="1.5" />
      <rect x="4" y="4" width="14" height="3" rx="1.5" />
      <rect x="4" y="10.5" width="11" height="3" rx="1.5" />
      <rect x="4" y="17" width="14" height="3" rx="1.5" />
    </svg>
  );
}

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  // Whoever owns this Content Delivery Network (CDN), I am using your CDN to serve emojis
  // Old CDN broken, so I had to switch to this one
  // Author: https://github.com/H0llyW00dzZ
  return `https://fastly.jsdelivr.net/npm/emoji-datasource-apple/img/${style}/64/${unified}.png`;
}

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={EmojiTheme.AUTO}
      getEmojiUrl={getEmojiUrl}
      onEmojiClick={(e) => {
        props.onEmojiClick(e.unified);
      }}
    />
  );
}

export function Avatar(props: { model?: Model; avatar?: string }) {
  if (props.model) {
    return (
      <div className="bot-avatar no-dark">
        <ElinorMark size={18} />
      </div>
    );
  }

  return (
    <div className="user-avatar">
      {props.avatar && <EmojiAvatar avatar={props.avatar} />}
    </div>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <Emoji
      unified={props.avatar}
      size={props.size ?? 18}
      getEmojiUrl={getEmojiUrl}
    />
  );
}
