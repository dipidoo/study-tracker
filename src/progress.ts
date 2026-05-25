/**
 * ProjectV2 R/W for study-tracker/progress. Lazy-creates DraftIssues per study unit.
 */
import { ghGraphQL } from './gh';

export type UnitStatus = 'not-started' | 'in-progress' | 'completed' | 'deferred';
export type Confidence = 'low' | 'medium' | 'high' | 'solid';

export interface ProgressRecord {
  itemId: string;
  unitId: string;
  status: UnitStatus;
  confidence?: Confidence;
  minutesSpent?: number;
  completedAt?: string;
  notes?: string;
}

export interface ProjectMeta {
  projectId: string;
  fields: {
    unitId: string;
    course: string;
    status: string;
    statusOptions: Record<UnitStatus, string>;
    confidence: string;
    confidenceOptions: Record<Confidence, string>;
    completedAt: string;
    minutesSpent: string;
  };
}

export async function findProjectByTitle(
  token: string,
  ownerLogin: string,
  expectedTitle: string,
): Promise<ProjectMeta | null> {
  const data = await ghGraphQL<{
    user: { projectsV2: { nodes: Array<{ id: string; title: string }> } };
  }>(
    token,
    `query($login: String!) { user(login: $login) { projectsV2(first: 50) { nodes { id title } } } }`,
    { login: ownerLogin },
  );
  const node = data.user.projectsV2.nodes.find((n) => n.title === expectedTitle);
  if (!node) return null;
  return loadFields(token, node.id);
}

async function loadFields(token: string, projectId: string): Promise<ProjectMeta> {
  const data = await ghGraphQL<{
    node: {
      fields: {
        nodes: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>;
      };
    };
  }>(
    token,
    `query($id: ID!) {
       node(id: $id) {
         ... on ProjectV2 {
           fields(first: 50) {
             nodes {
               ... on ProjectV2FieldCommon { id name }
               ... on ProjectV2SingleSelectField { id name options { id name } }
             }
           }
         }
       }
     }`,
    { id: projectId },
  );
  const byName = new Map(data.node.fields.nodes.map((f) => [f.name, f] as const));
  const status = byName.get('Status')!;
  const confidence = byName.get('Confidence')!;
  return {
    projectId,
    fields: {
      unitId: byName.get('UnitId')?.id ?? '',
      course: byName.get('Course')?.id ?? '',
      status: status.id,
      statusOptions: mapOptions(status.options ?? [], ['not-started', 'in-progress', 'completed', 'deferred']),
      confidence: confidence.id,
      confidenceOptions: mapOptions(confidence.options ?? [], ['low', 'medium', 'high', 'solid']),
      completedAt: byName.get('CompletedAt')?.id ?? '',
      minutesSpent: byName.get('MinutesSpent')?.id ?? '',
    },
  };
}

function mapOptions<T extends string>(
  options: Array<{ id: string; name: string }>,
  keys: T[],
): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const k of keys) {
    const opt = options.find((o) => o.name.toLowerCase() === k);
    if (opt) out[k] = opt.id;
  }
  return out;
}

interface ProgressItemsPage {
  node: {
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        id: string;
        content?: { body?: string };
        fieldValues: {
          nodes: Array<{
            field?: { id: string; name?: string };
            text?: string;
            date?: string;
            name?: string;
            number?: number;
          }>;
        };
      }>;
    };
  };
}

export async function listProgress(token: string, meta: ProjectMeta): Promise<ProgressRecord[]> {
  const out: ProgressRecord[] = [];
  let cursor: string | null = null;
  while (true) {
    const data: ProgressItemsPage = await ghGraphQL<ProgressItemsPage>(
      token,
      `query($id: ID!, $cursor: String) {
         node(id: $id) {
           ... on ProjectV2 {
             items(first: 100, after: $cursor) {
               pageInfo { hasNextPage endCursor }
               nodes {
                 id
                 content { ... on DraftIssue { body } }
                 fieldValues(first: 20) {
                   nodes {
                     ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } }
                     ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { id name } } }
                     ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } }
                     ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id name } } }
                   }
                 }
               }
             }
           }
         }
       }`,
      { id: meta.projectId, cursor },
    );
    for (const item of data.node.items.nodes) {
      const byField = (name: string) =>
        item.fieldValues.nodes.find((v: { field?: { name?: string } }) => v.field?.name === name);
      const unitIdVal = byField('UnitId')?.text;
      if (!unitIdVal) continue;
      out.push({
        itemId: item.id,
        unitId: unitIdVal,
        status: (byField('Status')?.name?.toLowerCase() as UnitStatus) ?? 'not-started',
        confidence: byField('Confidence')?.name?.toLowerCase() as Confidence | undefined,
        minutesSpent: byField('MinutesSpent')?.number,
        completedAt: byField('CompletedAt')?.date,
        notes: item.content?.body,
      });
    }
    if (!data.node.items.pageInfo.hasNextPage) break;
    cursor = data.node.items.pageInfo.endCursor;
  }
  return out;
}

/**
 * Create-or-update a progress item. The caller passes `existingItemId` from
 * its in-memory cache when the item is already known; the function NEVER
 * scans the board to look up an id. Returns the patched record so the caller
 * can update its cache without a full refetch.
 */
export async function upsertProgress(
  token: string,
  meta: ProjectMeta,
  unitId: string,
  courseCode: string,
  title: string,
  patch: Partial<ProgressRecord>,
  existingItemId?: string,
): Promise<ProgressRecord> {
  let itemId = existingItemId;
  if (!itemId) {
    const created = await ghGraphQL<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
      token,
      `mutation($projectId: ID!, $title: String!, $body: String) {
         addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
           projectItem { id }
         }
       }`,
      { projectId: meta.projectId, title, body: patch.notes ?? '' },
    );
    itemId = created.addProjectV2DraftIssue.projectItem.id;
    await setText(token, meta.projectId, itemId, meta.fields.unitId, unitId);
    await setText(token, meta.projectId, itemId, meta.fields.course, courseCode);
  }
  if (patch.status) {
    await setSingleSelect(token, meta.projectId, itemId, meta.fields.status, meta.fields.statusOptions[patch.status]);
  }
  if (patch.confidence) {
    await setSingleSelect(
      token,
      meta.projectId,
      itemId,
      meta.fields.confidence,
      meta.fields.confidenceOptions[patch.confidence],
    );
  }
  if (patch.minutesSpent !== undefined) {
    await setNumber(token, meta.projectId, itemId, meta.fields.minutesSpent, patch.minutesSpent);
  }
  if (patch.completedAt) {
    await setDate(token, meta.projectId, itemId, meta.fields.completedAt, patch.completedAt);
  }
  return {
    itemId,
    unitId,
    status: patch.status ?? 'in-progress',
    confidence: patch.confidence,
    minutesSpent: patch.minutesSpent,
    completedAt: patch.completedAt,
    notes: patch.notes,
  };
}

async function setText(token: string, projectId: string, itemId: string, fieldId: string, value: string) {
  await ghGraphQL(
    token,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
       updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { text: $value } }) { projectV2Item { id } }
     }`,
    { projectId, itemId, fieldId, value },
  );
}

async function setSingleSelect(token: string, projectId: string, itemId: string, fieldId: string, optionId: string) {
  await ghGraphQL(
    token,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
       updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } }
     }`,
    { projectId, itemId, fieldId, optionId },
  );
}

async function setNumber(token: string, projectId: string, itemId: string, fieldId: string, value: number) {
  await ghGraphQL(
    token,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
       updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { number: $value } }) { projectV2Item { id } }
     }`,
    { projectId, itemId, fieldId, value },
  );
}

async function setDate(token: string, projectId: string, itemId: string, fieldId: string, value: string) {
  await ghGraphQL(
    token,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Date!) {
       updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { date: $value } }) { projectV2Item { id } }
     }`,
    { projectId, itemId, fieldId, value },
  );
}
