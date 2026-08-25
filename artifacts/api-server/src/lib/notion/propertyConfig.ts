/**
 * Shared Notion property definition builder.
 * Merges switch-case from ai.ts confirm-action, telegram.ts executePendingAction,
 * and notion.ts POST /notion/properties.
 */

export function buildPropertyDefinition(
  name: string,
  propertyType: string,
): Record<string, unknown> {
  const def: Record<string, unknown> = {};

  switch (propertyType) {
    case "number":
      def[name] = { number: { format: "number" } };
      break;
    case "select":
      def[name] = { select: { options: [] } };
      break;
    case "multi_select":
      def[name] = { multi_select: { options: [] } };
      break;
    case "checkbox":
      def[name] = { checkbox: {} };
      break;
    case "date":
      def[name] = { date: {} };
      break;
    case "url":
      def[name] = { url: {} };
      break;
    case "rich_text":
    default:
      def[name] = { rich_text: {} };
      break;
  }

  return def;
}
