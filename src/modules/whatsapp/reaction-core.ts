export type MessageReaction={emoji:string;name:string};
export const REACTION_EMOJIS=["👍","❤️","😂","😮","😢","🙏","✅","👏","😊","🎉","👌","💪","🤝","👀","🚀","💚","😍","🙌","🤔","😅","🔥","💯","📌","⚠️"];
export function validReactionEmoji(value:unknown):value is string{
  return typeof value==="string"&&(value===""||value.length<=24&&[...new Intl.Segmenter("pt-BR",{granularity:"grapheme"}).segment(value)].length===1&&/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value));
}
