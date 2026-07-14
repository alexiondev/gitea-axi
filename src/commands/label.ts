import type { CreateLabelOption, EditLabelOption, Label } from "gitea-js";
import { createClient } from "../client.js";
import { resolveRepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError } from "../errors.js";
import { extractRow, pluck, type FieldDef } from "../fields.js";
import { flagValue, parseFlags, parsePositiveInt, parseSinglePositional } from "../flags.js";
import { findLabel, listAllLabels, resolveLabel } from "../lookup.js";
import { readTotalCount } from "../paginate.js";
import { formatCountLine, renderList, renderObject } from "../render.js";
import { suggestCommand } from "../suggestions.js";

export const LABEL_HELP = `usage: gitea-axi label <command> [flags]

commands:
  list       List labels in the current repository
  create     Create a label
  edit       Edit a label's name, color, or description
  delete     Delete a label

Run \`gitea-axi label <command> --help\` for the flags of a command.
`;

export const LABEL_LIST_HELP = `usage: gitea-axi label list [flags]

List labels in the current repository.

flags:
  --limit <n>           Maximum number of labels to return (default: 500)
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const LABEL_CREATE_HELP = `usage: gitea-axi label create --name <text> --color <hex> [flags]

Create a label in the current repository. Idempotent: a label whose name already
exists (case-insensitive) is reported rather than duplicated.

flags:
  --name <text>         Label name (required)
  --color <hex>         Label color as a hex code without \`#\` (required)
  --description <text>  Label description
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const LABEL_EDIT_HELP = `usage: gitea-axi label edit <name> [flags]

Edit a label in the current repository. The positional name is resolved
case-insensitively. At least one change is required.

flags:
  --name <text>         New label name
  --color <hex>         New color as a hex code without \`#\`
  --description <text>  New description
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const LABEL_DELETE_HELP = `usage: gitea-axi label delete <name>

Delete a label in the current repository. The positional name is resolved
case-insensitively. Deleting a nonexistent label is an error, not a silent
success (see ADR 0010).

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

const DEFAULT_LIMIT = 500;

const LABEL_LIST_HELP_SUGGESTION = ["Run `gitea-axi label list --help` to see available flags"];

// The list block carries only each label's name, per the spec.
const LABEL_LIST_FIELDS: FieldDef<Label>[] = [pluck("name")];

function parseLimit(value: string | true | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  return parsePositiveInt(value, "--limit", LABEL_LIST_HELP_SUGGESTION);
}

async function labelList(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return LABEL_LIST_HELP;
  }
  const { flags, positionals } = parseFlags(args, { "--limit": { takesValue: true } }, "label list");
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      LABEL_LIST_HELP_SUGGESTION,
    );
  }
  const limit = parseLimit(flags["--limit"]);

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let labels: Label[];
  let total: number | undefined;
  try {
    const response = await api.repos.issueListLabels(context.owner, context.name, {
      page: 1,
      limit,
    });
    labels = response.data ?? [];
    total = readTotalCount(response.headers);
  } catch (error) {
    throw classifyHttpError(error);
  }

  const now = new Date();
  const rows = labels.map((label) =>
    extractRow(label, LABEL_LIST_FIELDS, { now, host: context.host, full: false }),
  );
  return renderList({
    noun: "labels",
    rows,
    countLine: formatCountLine(rows.length, total, rows.length >= limit),
    help: [
      suggestCommand(
        context,
        'label create --name "<name>" --color <hex>',
        "to create a label",
      ),
    ],
  });
}

const LABEL_CREATE_HELP_SUGGESTION = ["Run `gitea-axi label create --help` to see available flags"];

/** Gitea's `CreateLabelOption.color` requires the leading `#`; the CLI takes it without. */
function withHash(color: string): string {
  return color.startsWith("#") ? color : `#${color}`;
}

async function labelCreate(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return LABEL_CREATE_HELP;
  }
  const { flags, positionals } = parseFlags(
    args,
    {
      "--name": { takesValue: true },
      "--color": { takesValue: true },
      "--description": { takesValue: true },
    },
    "label create",
  );
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      LABEL_CREATE_HELP_SUGGESTION,
    );
  }

  // Everything that can fail on the caller's own input is settled before any
  // request goes out, so a rejected invocation never half-creates a label.
  const name = flagValue(flags, "--name");
  if (name === undefined) {
    throw axiError("label create requires --name <text>", "VALIDATION_ERROR", [
      'Run `gitea-axi label create --name "<name>" --color <hex>`',
    ]);
  }
  const color = flagValue(flags, "--color");
  if (color === undefined) {
    throw axiError("label create requires --color <hex>", "VALIDATION_ERROR", [
      'Run `gitea-axi label create --name "<name>" --color <hex>`',
    ]);
  }
  const description = flagValue(flags, "--description");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  const help = [suggestCommand(context, "label list", "to see all labels")];

  // Fetch-first idempotency check (case-insensitive): an existing label is
  // reported as a no-op rather than re-POSTed, mirroring the create idempotency
  // the spec fixes. Note the output key is `create`, not `created`.
  const existing = findLabel(await listAllLabels(api, context), name);
  if (existing) {
    return renderObject({ create: "already_exists", label: existing.name ?? name }, help);
  }

  const payload: CreateLabelOption = { name, color: withHash(color) };
  if (description !== undefined) {
    payload.description = description;
  }
  let label: Label;
  try {
    const response = await api.repos.issueCreateLabel(context.owner, context.name, payload);
    label = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderObject({ created: "ok", label: label.name ?? name }, help);
}

async function labelEdit(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return LABEL_EDIT_HELP;
  }
  const { flags, positionals } = parseFlags(
    args,
    {
      "--name": { takesValue: true },
      "--color": { takesValue: true },
      "--description": { takesValue: true },
    },
    "label edit",
  );
  const name = parseSinglePositional(positionals, "label edit", "a label name", "<name>");
  const newName = flagValue(flags, "--name");
  const color = flagValue(flags, "--color");
  const description = flagValue(flags, "--description");
  if (newName === undefined && color === undefined && description === undefined) {
    throw axiError("label edit requires at least one change", "VALIDATION_ERROR", [
      "Run `gitea-axi label edit --help` to see the fields you can change",
    ]);
  }

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // The positional resolves case-insensitively before any mutation; an unknown
  // name surfaces here as a VALIDATION_ERROR rather than a half-applied edit.
  const label = await resolveLabel(api, context, name);

  const payload: EditLabelOption = {};
  if (newName !== undefined) {
    payload.name = newName;
  }
  if (color !== undefined) {
    payload.color = withHash(color);
  }
  if (description !== undefined) {
    payload.description = description;
  }
  let edited: Label;
  try {
    const response = await api.repos.issueEditLabel(context.owner, context.name, label.id!, payload);
    edited = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  // The resulting name is the API's echo of the edited label: the new name when
  // one was given, otherwise the unchanged original.
  return renderObject({ edit: "ok", label: edited.name ?? newName ?? label.name ?? name }, [
    suggestCommand(context, "label list", "to see all labels"),
  ]);
}

async function labelDelete(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return LABEL_DELETE_HELP;
  }
  const { positionals } = parseFlags(args, {}, "label delete");
  const name = parseSinglePositional(positionals, "label delete", "a label name", "<name>");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Deliberately not idempotent (ADR 0010): the positional resolves via the
  // standard case-insensitive lookup, so an unknown name is refused with a
  // VALIDATION_ERROR here rather than reported as a deletion that never happened.
  const label = await resolveLabel(api, context, name);
  try {
    await api.repos.issueDeleteLabel(context.owner, context.name, label.id!);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderObject({ delete: "ok", label: label.name ?? name }, [
    suggestCommand(context, "label list", "to see the remaining labels"),
  ]);
}

export function labelCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return LABEL_HELP;
    }
    if (subcommand === "list") {
      return labelList(deps, rest);
    }
    if (subcommand === "create") {
      return labelCreate(deps, rest);
    }
    if (subcommand === "edit") {
      return labelEdit(deps, rest);
    }
    if (subcommand === "delete") {
      return labelDelete(deps, rest);
    }
    throw axiError(`Unknown label command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi label --help` to see available label commands",
    ]);
  };
}
