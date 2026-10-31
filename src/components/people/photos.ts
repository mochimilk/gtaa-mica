// The made-up teammates' profile pictures (../../live/callGuests' TEAM), for
// their avatars wherever they show: the chat, the call, the People list and
// Outputs. Anyone without one shows their initials.
import dana from "../../assets/people/001.png";
import travis from "../../assets/people/002.png";
import priya from "../../assets/people/003.png";
import sofia from "../../assets/people/004.png";

const PHOTOS: Readonly<Record<string, string>> = {
  "Travis Hughes": travis,
  "Dana Kowalski": dana,
  "Priya Raman": priya,
  "Sofia Reyes": sofia,
};

/** `name`'s picture, as a Fluent Avatar's `image`; undefined for anyone without one. */
export const photoOf = (name: string | undefined): { src: string } | undefined => {
  const src = name ? PHOTOS[name] : undefined;
  return src ? { src } : undefined;
};
