/**
 * Every word and detail shown on the page, in one place. Replace all of it
 * with the real content from the brief: no TODOs may survive into a finished
 * page. Add fields as the brief needs them; keep components reading from here
 * rather than hard-coding strings.
 */
export interface NavLink {
  label: string;
  href: string;
}

export interface Action {
  label: string;
  href: string;
}

export const site = {
  name: "{{name}}",

  /** Shown in the header and the footer. Keep it short. */
  nav: [{ label: "TODO: section name", href: "#todo-section" }] as NavLink[],

  hero: {
    /** The one <h1> on the page. Say what this is, for whom. */
    heading: "TODO: the headline",
    /** One or two sentences under the headline. */
    body: "TODO: what you offer, in plain words.",
    /** The single most important action a visitor can take. */
    action: { label: "TODO: the action", href: "#todo-section" } as Action,
  },

  footer: {
    /** Address, hours, contact — whatever the brief says belongs at the end. */
    lines: ["TODO: contact details"],
    /** Repeat the hero action, or point at the most useful link. */
    action: { label: "TODO: the action", href: "#todo-section" } as Action,
  },
} as const;
