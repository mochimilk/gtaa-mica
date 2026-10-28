// Settings' API page: the user's own OpenAI key, for Skye's voice calls and
// the interpreter that turns requests into actions, in place of the voice
// broker's (OPENAI_API_KEY, server/micaLiveServer.mjs). Visual only for now:
// the key lives in this page's state, so nothing keeps it, sends it or reads it.
import { useState } from "react";
import { Eye } from "@coral-ai/bundleicons/Eye";
import { EyeOff } from "@coral-ai/bundleicons/EyeOff";
import { Button, Field, Input, Label, makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
});

export function ApiSettings() {
  const styles = useStyles();
  const [apiKey, setApiKey] = useState("");
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.root}>
      <Label size="large" weight="semibold">
        API
      </Label>
      <Field
        label={{ children: "OpenAI API key", weight: "semibold" }}
        hint="Skye's voice calls and requests use it in place of Mica's own key."
      >
        <Input
          type={shown ? "text" : "password"}
          value={apiKey}
          onChange={(_, data) => setApiKey(data.value)}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          contentAfter={
            <Button
              appearance="transparent"
              size="small"
              icon={shown ? <EyeOff /> : <Eye />}
              aria-label={shown ? "Hide key" : "Show key"}
              onClick={() => setShown(!shown)}
            />
          }
        />
      </Field>
    </div>
  );
}
