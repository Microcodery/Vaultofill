import { PasswordPrompt } from "../storage/encryptedVaultStore";

/**
 * An inline, accessible password prompt for unlocking the encrypted vault. Each
 * call renders a small form into `host` (label + password input + Unlock/Cancel +
 * an error line) and resolves with the entered password, or null if the user
 * cancels. The EncryptedVaultStore calls this in a loop, passing `error` to
 * re-prompt after a wrong attempt.
 */
export function createPasswordPrompt(host: HTMLElement, opts: { title?: string } = {}): PasswordPrompt {
  return ({ error }) =>
    new Promise<string | null>((resolve) => {
      host.innerHTML = "";
      host.hidden = false;

      const form = document.createElement("form");
      form.className = "vof-unlock";
      form.setAttribute("aria-label", opts.title ?? "Unlock your vault");

      const heading = document.createElement("div");
      heading.className = "vof-unlock-title";
      heading.textContent = opts.title ?? "Vault locked";
      form.appendChild(heading);

      const label = document.createElement("label");
      label.className = "vof-unlock-label";
      label.textContent = "Vault password";
      const input = document.createElement("input");
      input.type = "password";
      input.className = "vof-unlock-input";
      input.autocomplete = "current-password";
      label.appendChild(input);
      form.appendChild(label);

      const err = document.createElement("div");
      err.className = "vof-unlock-error";
      err.setAttribute("role", "alert");
      if (error) err.textContent = error;
      form.appendChild(err);

      const actions = document.createElement("div");
      actions.className = "vof-unlock-actions";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Unlock";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      actions.append(submit, cancel);
      form.appendChild(actions);

      const done = (value: string | null): void => {
        host.hidden = true;
        host.innerHTML = "";
        resolve(value);
      };
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        done(input.value);
      });
      cancel.addEventListener("click", () => done(null));

      host.appendChild(form);
      input.focus();
    });
}
