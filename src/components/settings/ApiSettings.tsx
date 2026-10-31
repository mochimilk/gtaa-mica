// Settings' API page: the user's own key for Skye's voice calls and the
// interpreter that turns requests into actions, in place of the voice
// broker's (OPENAI_API_KEY, server/micaLiveServer.mjs). A table of keys, as an
// API dashboard's: each one masked, its provider, and a trash button to remove
// it; + at the page name's end adds a row to paste one into, with its
// provider (OpenAI only, for now) and Save.
//
// In the desktop app a key goes to its main process (electron/appVoice.mjs),
// which keeps it in memory for this window until it reloads or closes. This
// page lets go of it as soon as it is handed over and gets back only its
// masked form. A browser has nowhere to keep it from the page, so there + is
// off. A window keeps one key, so saving another replaces it.
import { useEffect, useState, type KeyboardEvent } from "react";
import { Add } from "@coral-ai/bundleicons/Add";
import { Delete } from "@coral-ai/bundleicons/Delete";
import { Dismiss } from "@coral-ai/bundleicons/Dismiss";
import { Eye } from "@coral-ai/bundleicons/Eye";
import { EyeOff } from "@coral-ai/bundleicons/EyeOff";
import {
  Button,
  Caption1,
  Dropdown,
  Field,
  Input,
  Label,
  Option,
  Table,
  TableBody,
  TableCell,
  TableCellLayout,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { desktopVoice, forgetVoiceKey, setVoiceKey, voiceKey, type VoiceKey, type VoiceProvider } from "../../live";

/** Who a key can be for. */
const PROVIDERS: { value: VoiceProvider; label: string }[] = [{ value: "openai", label: "OpenAI" }];
const providerLabel = (value: VoiceProvider) => PROVIDERS.find((p) => p.value === value)?.label ?? value;

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  // The page's name, and + at its end.
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  provider: { width: "160px" },
  actions: { width: "128px" },
  // The row's buttons, at its end.
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  // The field's message under it is the row's to grow by, so its cells sit at its top.
  editing: { verticalAlign: "top", paddingTop: tokens.spacingVerticalS, paddingBottom: tokens.spacingVerticalS },
  fill: { width: "100%", minWidth: 0 },
  // Dots, as a password field's are, on a plain text field: a password field
  // has the browser and password managers offer to save what's in it.
  masked: {
    WebkitTextSecurity: "disc",
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
});

export function ApiSettings() {
  const styles = useStyles();
  const desktop = Boolean(desktopVoice());
  // The window's key, masked; undefined until the app has said.
  const [key, setKey] = useState<VoiceKey | null | undefined>(undefined);
  // The row being added: what's typed, until it's handed over. The window's key is never here.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState<VoiceProvider>("openai");
  const [shown, setShown] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void voiceKey()
      .catch(() => null)
      .then((value) => current && setKey(value));
    return () => {
      current = false;
    };
  }, []);

  const add = () => {
    setAdding(true);
    setDraft("");
    setProvider("openai");
    setShown(false);
    setError(null);
  };
  const cancel = () => {
    setAdding(false);
    setDraft("");
    setError(null);
  };
  const save = async () => {
    if (busy || draft.trim() === "") return;
    setBusy(true);
    try {
      if (!(await setVoiceKey(provider, draft))) {
        setError(`That doesn't look like an ${providerLabel(provider)} API key. They start with sk-.`);
        return;
      }
      cancel();
      setKey(await voiceKey());
    } catch {
      // The app's main process didn't answer: one started before this page
      // had a key to give it, as a window reload doesn't restart it.
      setError("The app couldn't take the key. Restart the desktop app and try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    await forgetVoiceKey().catch(() => {});
    setKey(await voiceKey().catch(() => null));
    setBusy(false);
  };
  // Escape closes the provider list, or stops adding, not the whole overlay
  // (Coral's Overlay listens on the document).
  const onEditKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (!providersOpen) cancel();
  };

  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <Label size="large" weight="semibold">
          API
        </Label>
        <Tooltip content="Add API key" relationship="label">
          <Button appearance="subtle" icon={<Add />} disabled={!desktop || adding} onClick={add} />
        </Tooltip>
      </div>

      <Table aria-label="API keys">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>API</TableHeaderCell>
            <TableHeaderCell className={styles.provider}>Provider</TableHeaderCell>
            <TableHeaderCell className={styles.actions} aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {key && (
            <TableRow>
              <TableCell>
                <TableCellLayout truncate>{key.hint}</TableCellLayout>
              </TableCell>
              <TableCell>{providerLabel(key.provider)}</TableCell>
              <TableCell>
                <div className={styles.buttons}>
                  <Tooltip content="Remove key" relationship="label">
                    <Button appearance="subtle" icon={<Delete />} disabled={busy} onClick={() => void remove()} />
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          )}

          {adding && (
            <TableRow onKeyDown={onEditKeyDown}>
              <TableCell className={styles.editing}>
                <Field validationState={error ? "error" : "none"} validationMessage={error ?? undefined}>
                  {/* Not saved anywhere: no autofill, and the managers' own opt-outs (1Password, LastPass). */}
                  <Input
                    autoFocus
                    aria-label={`${providerLabel(provider)} API key`}
                    className={styles.fill}
                    value={draft}
                    onChange={(_, data) => {
                      setDraft(data.value);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void save();
                    }}
                    input={{ className: shown ? undefined : styles.masked }}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
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
              </TableCell>
              <TableCell className={styles.editing}>
                {/* Inline, so its list sits inside the overlay rather than under its backdrop. */}
                <Dropdown
                  inlinePopup
                  aria-label="Provider"
                  className={styles.fill}
                  value={providerLabel(provider)}
                  selectedOptions={[provider]}
                  onOptionSelect={(_, data) => data.optionValue && setProvider(data.optionValue as VoiceProvider)}
                  onOpenChange={(_, data) => setProvidersOpen(data.open)}
                >
                  {PROVIDERS.map(({ value, label }) => (
                    <Option key={value} value={value}>
                      {label}
                    </Option>
                  ))}
                </Dropdown>
              </TableCell>
              <TableCell className={styles.editing}>
                <div className={styles.buttons}>
                  <Button appearance="primary" disabled={busy || draft.trim() === ""} onClick={() => void save()}>
                    {key ? "Replace" : "Save"}
                  </Button>
                  <Tooltip content="Cancel" relationship="label">
                    <Button appearance="subtle" icon={<Dismiss />} disabled={busy} onClick={cancel} />
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          )}

          {key === null && !adding && (
            <TableRow>
              <TableCell colSpan={3}>
                <TableCellLayout className={styles.muted}>
                  {desktop
                    ? "No key yet. Add one with + to talk to Skye."
                    : "Only in the desktop app. In a browser, Skye uses Mica's voice backend and its own key."}
                </TableCellLayout>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {desktop && (
        <Caption1 className={styles.muted}>
          Skye's voice calls and requests use your key in place of Mica's own. It's kept in this window's memory only:
          never saved, never shown in full, and gone when you reload or close the app.
        </Caption1>
      )}
    </div>
  );
}
