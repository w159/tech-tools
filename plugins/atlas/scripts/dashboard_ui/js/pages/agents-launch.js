// Launch agent modal: name, prompt, project and harness, posted to /api/v2/herd/panes.
import { h, baseName } from "../dom.js";
import { Modal, Button, Field, Input, Textarea, Select, toast } from "../ui.js";
import { get, post, describeError } from "../api.js";
import { NAME_PATTERN } from "./agents-model.js";

const HARNESSES = [
  { value: "claude", label: "Claude Code" },
  { value: "omp", label: "omp" },
];

/** openLaunchModal({project, onLaunched(name)}). `project` is the sidebar selection (root or "all"). */
export async function openLaunchModal({ project, onLaunched }) {
  let projects = [];
  try {
    projects = ((await get("/api/v2/projects")).projects || []).filter(
      (p) => p.root,
    );
  } catch (e) {
    const d = describeError(e);
    toast("Projects did not load", { kind: "error", detail: d.message });
    return;
  }
  if (!projects.length) {
    toast("No projects to launch into", {
      kind: "warn",
      detail: "Add a project first.",
    });
    return;
  }
  const name = Input({
    mono: true,
    placeholder: "fix-login-bug",
    autocomplete: "off",
    autofocus: true,
  });
  const prompt = Textarea({
    rows: 4,
    placeholder: "What should this agent do?",
  });
  const select = Select({
    label: "Project",
    options: projects.map((p) => ({
      value: p.root,
      label: p.name || baseName(p.root),
    })),
    value: projects.some((p) => p.root === project)
      ? project
      : projects[0].root,
  });
  let harness = "claude";
  const radios = h(
    "div",
    { class: "radio-row", role: "radiogroup", "aria-label": "Harness" },
    HARNESSES.map((o) =>
      h(
        "label",
        { class: "radio" },
        h("input", {
          type: "radio",
          name: "harness",
          value: o.value,
          checked: o.value === harness,
          onChange: () => {
            harness = o.value;
          },
        }),
        o.label,
      ),
    ),
  );
  const nameError = h("span", {
    class: "field-error",
    role: "alert",
    hidden: true,
  });
  const submit = Button({ variant: "primary" }, "Launch");
  const cancel = Button({}, "Cancel");
  const modal = Modal(
    { title: "Launch agent", footer: [cancel, submit] },
    Field({ label: "Name" }, name),
    nameError,
    Field({ label: "Prompt" }, prompt),
    Field({ label: "Project" }, select),
    h(
      "div",
      { class: "field" },
      h("span", { class: "label" }, "Harness"),
      radios,
    ),
  );
  cancel.addEventListener("click", modal.close);

  const checkName = () => {
    const bad = !NAME_PATTERN.test(name.value);
    nameError.hidden = !bad;
    nameError.textContent = bad
      ? "Use lowercase words joined by hyphens, like fix-login-bug."
      : "";
    name.setAttribute("aria-invalid", String(bad));
    return !bad;
  };
  name.addEventListener("input", checkName);

  submit.addEventListener("click", async () => {
    if (!checkName()) return name.focus();
    submit.disabled = true;
    try {
      await post("/api/v2/herd/panes", {
        name: name.value,
        prompt: prompt.value,
        project: select.value,
        harness,
      });
      toast(`Launched ${name.value}`, { kind: "ok" });
      modal.close();
      if (onLaunched) onLaunched(name.value);
    } catch (e) {
      const d = describeError(e);
      toast(d.message, { kind: "error", detail: d.detail });
      submit.disabled = false;
    }
  });
}
