import { EncryptionConfig } from "../storage/encryptionConfig";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "../storage/encryptedVaultStore";

/** The operations the encryption settings section needs, injected so the view is
 *  unit-testable without a real store/storage. `enable`/`disable`/`setMode` reject
 *  on invalid input (too-short/mismatched/wrong password); the view surfaces the
 *  message inline. */
export interface EncryptionSettingsDeps {
  loadConfig(): Promise<EncryptionConfig>;
  enable(password: string, unlock: EncryptionConfig["unlock"]): Promise<void>;
  disable(password: string): Promise<void>;
  /** Change the unlock frequency while encryption stays on (no password needed). */
  setMode(unlock: EncryptionConfig["unlock"]): Promise<void>;
  minPasswordLength?: number;
}

/** The three user-facing states, mapped to EncryptionConfig by `choiceOf`. */
type Choice = "off" | "session" | "always";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "off", label: "No encryption" },
  { value: "session", label: "Encrypt — ask for the password once per browser session" },
  { value: "always", label: "Encrypt — ask for the password each time the panel opens" },
];
const choiceOf = (cfg: EncryptionConfig): Choice => (cfg.enabled ? cfg.unlock : "off");

function passwordField(labelText: string, autocomplete: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement("label");
  wrap.className = "vof-enc-field";
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.type = "password";
  input.setAttribute("autocomplete", autocomplete);
  wrap.appendChild(input);
  return { wrap, input };
}

function submitButton(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "submit";
  b.textContent = text;
  return b;
}

/**
 * Render the "Encryption" settings section as a single three-way choice — No
 * encryption / once per browser session / once per panel open. Picking a different
 * option reveals the action it needs: a new password (×2) to turn encryption on,
 * the current password to turn it off, or a one-click switch between the two
 * unlock frequencies (already unlocked, so no password). Re-renders after a change.
 */
export async function renderEncryptionSettings(container: HTMLElement, deps: EncryptionSettingsDeps): Promise<void> {
  const min = deps.minPasswordLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
  const cfg = await deps.loadConfig();
  const current = choiceOf(cfg);
  container.innerHTML = "";
  const rerender = (): void => void renderEncryptionSettings(container, deps);

  const status = document.createElement("p");
  status.className = "vof-enc-status";
  status.textContent =
    current === "off"
      ? "Encryption is OFF — your saved values are stored unencrypted on this device."
      : current === "session"
        ? "Encryption is ON — unlocked once per browser session."
        : "Encryption is ON — unlocked each time you open the panel.";
  container.appendChild(status);

  const note = document.createElement("p");
  note.className = "vof-enc-note";
  note.textContent =
    "Protects the saved-values blob at rest with your password. It does not protect a compromised browser — the vault and key are in memory while in use.";
  container.appendChild(note);

  const group = document.createElement("fieldset");
  group.className = "vof-enc-mode";
  const legend = document.createElement("legend");
  legend.textContent = "Saved-values encryption";
  group.appendChild(legend);

  const action = document.createElement("div");
  action.className = "vof-enc-action";
  const error = document.createElement("div");
  error.className = "vof-enc-error";
  error.setAttribute("role", "alert");

  const fail = (submit: HTMLButtonElement) => (err: unknown): void => {
    error.textContent = err instanceof Error && err.message ? err.message : "Could not update encryption.";
    submit.disabled = false;
  };

  const renderEnable = (unlock: EncryptionConfig["unlock"]): void => {
    const form = document.createElement("form");
    form.className = "vof-enc-form";
    form.setAttribute("aria-label", "Turn on encryption");
    const pw = passwordField(`New password (min ${min} characters)`, "new-password");
    const confirm = passwordField("Confirm password", "new-password");
    const submit = submitButton("Turn on encryption");
    form.append(pw.wrap, confirm.wrap, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      error.textContent = "";
      if (pw.input.value.length < min) {
        error.textContent = `Password must be at least ${min} characters.`;
        return;
      }
      if (pw.input.value !== confirm.input.value) {
        error.textContent = "Passwords do not match.";
        return;
      }
      submit.disabled = true;
      void deps.enable(pw.input.value, unlock).then(rerender).catch(fail(submit));
    });
    action.appendChild(form);
    pw.input.focus();
  };

  const renderDisable = (): void => {
    const form = document.createElement("form");
    form.className = "vof-enc-form";
    form.setAttribute("aria-label", "Turn off encryption");
    const pw = passwordField("Current password", "current-password");
    const submit = submitButton("Turn off encryption");
    form.append(pw.wrap, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      void deps.disable(pw.input.value).then(rerender).catch(fail(submit));
    });
    action.appendChild(form);
    pw.input.focus();
  };

  const renderSwitch = (unlock: EncryptionConfig["unlock"]): void => {
    const form = document.createElement("form");
    form.className = "vof-enc-form";
    form.setAttribute("aria-label", "Change unlock frequency");
    const hint = document.createElement("p");
    hint.className = "vof-enc-hint";
    hint.textContent =
      unlock === "session"
        ? "Remember the password for the rest of this browser session."
        : "Ask for the password each time the panel opens.";
    const submit = submitButton("Apply");
    form.append(hint, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      void deps.setMode(unlock).then(rerender).catch(fail(submit));
    });
    action.appendChild(form);
  };

  const renderAction = (sel: Choice): void => {
    action.innerHTML = "";
    error.textContent = "";
    if (sel === current) return; // nothing to change
    if (current === "off") return renderEnable(sel as EncryptionConfig["unlock"]); // off → encrypted
    if (sel === "off") return renderDisable(); // encrypted → off
    renderSwitch(sel as EncryptionConfig["unlock"]); // session ↔ always
  };

  for (const c of CHOICES) {
    const l = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "vof-enc-choice";
    r.value = c.value;
    if (c.value === current) r.checked = true;
    r.addEventListener("change", () => { if (r.checked) renderAction(c.value); });
    l.append(r, document.createTextNode(` ${c.label}`));
    group.appendChild(l);
  }

  container.append(group, action, error);
}
