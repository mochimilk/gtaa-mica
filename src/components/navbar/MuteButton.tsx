import { Button, Tooltip } from "@fluentui/react-components";
import { bundleIcon, Mic20Filled, Mic20Regular, MicOff20Filled, MicOff20Regular } from "@fluentui/react-icons";
import { useLiveCall } from "../../live";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const MicIcon = bundleIcon(Mic20Filled, Mic20Regular);
const MicOffIcon = bundleIcon(MicOff20Filled, MicOff20Regular);

/**
 * The user's microphone for the whole call, Skye and anyone else on it. Mute
 * is held by the call controller, so it also applies to a call placed later.
 */
export function MuteButton() {
  const live = useLiveCall();
  const { muted } = live.state;
  return (
    // A plain subtle button, not a toggle: the icon and the label carry the state.
    <Tooltip content={muted ? "Unmute microphone" : "Mute microphone"} relationship="label">
      <Button appearance="subtle" icon={muted ? <MicOffIcon /> : <MicIcon />} onClick={() => live.setMuted(!muted)} />
    </Tooltip>
  );
}
